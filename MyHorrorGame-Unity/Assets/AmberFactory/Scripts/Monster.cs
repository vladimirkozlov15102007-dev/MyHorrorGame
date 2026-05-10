using System.Collections.Generic;
using UnityEngine;

namespace AmberFactory
{
    /// <summary>
    /// Adaptive enemy AI.
    /// FSM: Patrol → Investigate → Chase → Ambush → SearchHiding.
    /// Blackboard holds last-seen, last-noise, adaptive counters.
    /// Inputs: sight (forward cone + LOS), hearing (player noise & thrown noise).
    /// </summary>
    public class Monster : MonoBehaviour
    {
        public enum State { Patrol, Investigate, Chase, Ambush, SearchHiding, Stunned }

        public State CurrentState = State.Patrol;
        public float Alert; // 0..1
        public bool IsChasing => CurrentState == State.Chase;

        private const float SIGHT_DIST = 16f;
        private const float SIGHT_FOV_DEG = 105f;
        private const float HEAR_BASE = 12f;
        private const float CATCH_DIST = 1.2f;

        // Blackboard
        public Vector3? LastSeen;
        public float LastSeenTime = -999;
        public Vector3? LastNoise;
        public float LastNoiseTime = -999;
        public Vector3 AmbushPos;
        public float AmbushUntil;
        public bool WitnessedHide;

        // Adaptive counters 0..1
        public float HideScore;
        public float FlashScore;   // unused (no flashlight) — kept for symmetry
        public float SprintScore;

        // Path
        private List<Vector3> _path;
        private int _pathIndex;
        private Vector3 _pathTarget;
        private float _pathCooldown;
        private float _stateTimer;
        private float _globalTimer;
        private float _footTimer;
        private float _growlCd;

        private LevelBuilder _level;
        private PlayerController _player;
        private MonsterMesh _mesh;
        private float _yaw;

        private bool _paused;

        public void Init(LevelBuilder level, PlayerController player)
        {
            _level = level;
            _player = player;
            transform.position = level.MonsterSpawn;

            // Build mesh
            var meshGO = new GameObject("MonsterMesh");
            meshGO.transform.SetParent(transform, false);
            _mesh = meshGO.AddComponent<MonsterMesh>();
            _mesh.Build();
        }

        public void Pause(bool paused) { _paused = paused; }

        public void ResetTo(Vector3 pos)
        {
            transform.position = pos;
            CurrentState = State.Patrol;
            Alert = 0;
            LastSeen = null; LastSeenTime = -999;
            LastNoise = null; LastNoiseTime = -999;
            WitnessedHide = false;
            HideScore = FlashScore = SprintScore = 0;
            _path = null;
            _pathIndex = 0;
            _stateTimer = 0;
            _globalTimer = 0;
        }

        private void Update()
        {
            if (_paused || _player == null) return;

            _globalTimer += Time.deltaTime;
            _stateTimer += Time.deltaTime;

            // Update adaptive counters from player
            HideScore = Mathf.Clamp01(_player.TimesHidden / 4f);
            SprintScore = Mathf.Clamp01(_player.SprintSeconds / 18f);

            // --- Consume noises from throwables ---
            var thrownNoises = GameManager.I.Throwables.PopNoises();
            foreach (var n in thrownNoises)
            {
                LastNoise = n.Pos;
                LastNoiseTime = _globalTimer;
            }

            var sense = Sense();
            Transition(sense);

            switch (CurrentState)
            {
                case State.Patrol: DoPatrol(); break;
                case State.Investigate: DoInvestigate(); break;
                case State.Chase: DoChase(sense); break;
                case State.Ambush: DoAmbush(); break;
                case State.SearchHiding: DoSearchHiding(); break;
                case State.Stunned: DoStunned(); break;
            }

            // Alert level (for music)
            float targetAlert = 0f;
            if (sense.CanSee) targetAlert = 1f;
            else if (CurrentState == State.Chase) targetAlert = 1f;
            else if (CurrentState == State.Ambush) targetAlert = 0.8f;
            else if (CurrentState == State.SearchHiding) targetAlert = 0.55f;
            else if (CurrentState == State.Investigate) targetAlert = 0.5f;
            Alert = Mathf.Lerp(Alert, targetAlert, Time.deltaTime * 2f);

            // Catch check
            float dist = Vector3.Distance(transform.position, _player.transform.position);
            if (!_player.Hidden && dist < CATCH_DIST)
            {
                GameManager.I.Die("The long arms close around you. You never saw the sky again.");
                return;
            }
            if (_player.Hidden && _player.CurrentHideSpot != null && WitnessedHide && CurrentState == State.SearchHiding)
            {
                float lockerDist = Vector3.Distance(transform.position, _player.CurrentHideSpot.transform.position);
                if (lockerDist < 1.4f)
                {
                    GameManager.I.Die("It knew you were there.");
                    return;
                }
            }

            // Orient mesh
            transform.rotation = Quaternion.Lerp(transform.rotation, Quaternion.Euler(0, _yaw, 0), Time.deltaTime * 6f);
            _mesh.Animate(Time.deltaTime, _velLen);
        }

        // ---------- Sensing ----------
        private struct Sense { public bool CanSee; public bool Heard; public float Dist; }

        private Sense Sense()
        {
            var mp = transform.position;
            var pp = _player.transform.position;
            var s = new Sense();
            s.Dist = Vector3.Distance(mp, pp);

            // If player hidden → monster can only detect via chase memory
            if (!_player.Hidden)
            {
                // Sight
                if (s.Dist < SIGHT_DIST)
                {
                    Vector3 fwd = new Vector3(Mathf.Sin(_yaw * Mathf.Deg2Rad), 0, Mathf.Cos(_yaw * Mathf.Deg2Rad));
                    Vector3 to = (pp - mp); to.y = 0; to.Normalize();
                    float dot = Vector3.Dot(fwd, to);
                    float ang = Mathf.Acos(Mathf.Clamp(dot, -1f, 1f)) * Mathf.Rad2Deg;
                    if (ang < SIGHT_FOV_DEG * 0.5f)
                    {
                        // LOS raycast
                        Vector3 origin = mp + Vector3.up * 1.7f;
                        Vector3 target = pp + Vector3.up * 1.4f;
                        Vector3 dir = (target - origin).normalized;
                        float distance = (target - origin).magnitude;
                        if (Physics.Raycast(origin, dir, out var hit, distance, Physics.DefaultRaycastLayers, QueryTriggerInteraction.Ignore))
                        {
                            // If we hit the player first, we still "see" them
                            if (hit.collider.GetComponentInParent<PlayerController>() != null)
                                s.CanSee = true;
                        }
                        else
                        {
                            s.CanSee = true;
                        }
                    }
                }
                // Hearing
                float hearMult = 1f + SprintScore * 0.8f;
                float noise = _player.NoiseThisFrame;
                if (noise > 0f)
                {
                    float r = HEAR_BASE * hearMult * noise;
                    if (s.Dist < r)
                    {
                        s.Heard = true;
                        LastNoise = _player.NoisePos;
                        LastNoiseTime = _globalTimer;
                    }
                }
            }
            else
            {
                // Witness hide if we were chasing within 0.8s
                if (CurrentState == State.Chase && _globalTimer - LastSeenTime < 0.8f)
                    WitnessedHide = true;
            }

            if (s.CanSee)
            {
                LastSeen = pp;
                LastSeenTime = _globalTimer;
            }
            return s;
        }

        // ---------- FSM ----------

        private void Transition(Sense s)
        {
            if (s.CanSee) { SetState(State.Chase); if (_globalTimer - _growlCd > 4f) { _growlCd = _globalTimer; ProceduralAudio.Instance.PlayOneShot3D(ProceduralAudio.Instance.MonsterGrowl, transform.position); } return; }

            if (_player.Hidden && WitnessedHide && CurrentState != State.SearchHiding)
            {
                SetState(State.SearchHiding);
                return;
            }

            if (CurrentState == State.Chase)
            {
                if (_globalTimer - LastSeenTime > 3.0f)
                {
                    if (HideScore > 0.35f && Random.value < 0.35f + HideScore * 0.3f)
                    {
                        PickAmbushNear(LastSeen ?? _player.transform.position);
                        SetState(State.Ambush);
                    }
                    else SetState(State.Investigate);
                }
                return;
            }

            if (_globalTimer - LastNoiseTime < 0.3f)
            {
                SetState(State.Investigate);
                _pathCooldown = 0;
                return;
            }

            if (CurrentState == State.Ambush && _globalTimer > AmbushUntil) SetState(State.Patrol);
            if (CurrentState == State.SearchHiding && (_stateTimer > 12f || !_player.Hidden)) { WitnessedHide = false; SetState(State.Patrol); }
            if (CurrentState == State.Investigate && (_stateTimer > 8f || AtPathEnd())) SetState(State.Patrol);
        }

        private void SetState(State s)
        {
            if (CurrentState == s) return;
            CurrentState = s;
            _stateTimer = 0;
            _path = null;
            _pathIndex = 0;
            _pathCooldown = 0;
        }

        // ---------- Behaviors ----------
        private void DoPatrol()
        {
            if (_path == null || AtPathEnd())
            {
                var c = _level.Nav.RandomWalkable();
                var target = _level.Nav.CellToWorld(c.x, c.y);
                SetPath(target);
            }
            FollowPath(1.8f);
        }

        private void DoInvestigate()
        {
            Vector3? target = null;
            float bestT = 999f;
            if (LastSeen.HasValue && _globalTimer - LastSeenTime < bestT) { bestT = _globalTimer - LastSeenTime; target = LastSeen; }
            if (LastNoise.HasValue && _globalTimer - LastNoiseTime < bestT) { bestT = _globalTimer - LastNoiseTime; target = LastNoise; }
            if (!target.HasValue) { SetState(State.Patrol); return; }
            if (_path == null || Vector3.Distance(_pathTarget, target.Value) > 2.5f) SetPath(target.Value);
            FollowPath(2.6f);
            if (Random.value < Time.deltaTime * 0.3f) ProceduralAudio.Instance.PlayOneShot3D(ProceduralAudio.Instance.MonsterBreath, transform.position, 0.6f);
        }

        private void DoChase(Sense s)
        {
            Vector3 tgt = s.CanSee ? _player.transform.position : (LastSeen ?? _player.transform.position);
            if (_path == null || _pathCooldown <= 0f || Vector3.Distance(_pathTarget, tgt) > 2f) { SetPath(tgt); _pathCooldown = 0.25f; }
            else _pathCooldown -= Time.deltaTime;
            float speed = 4.6f + SprintScore * 1.6f;
            FollowPath(speed);
        }

        private void DoAmbush()
        {
            if (_path == null) SetPath(AmbushPos);
            if (Vector3.Distance(transform.position, AmbushPos) > 1f && !AtPathEnd())
                FollowPath(2.6f);
            else
            {
                // Stand still, slowly pan
                _yaw += Mathf.Sin(_globalTimer * 0.7f) * Time.deltaTime * 25f;
                if (Random.value < Time.deltaTime * 0.3f)
                    ProceduralAudio.Instance.PlayOneShot3D(ProceduralAudio.Instance.MonsterGrowl, transform.position, 0.5f);
            }
        }

        private void DoSearchHiding()
        {
            if (_path == null || AtPathEnd())
            {
                HidingSpot best = null;
                float bestD = 999f;
                foreach (var l in _level.HidingSpots)
                {
                    float d = Vector3.Distance(l.transform.position, transform.position);
                    if (d < bestD) { bestD = d; best = l; }
                }
                if (best != null) SetPath(best.EntryWorldPos);
            }
            FollowPath(2.8f + HideScore * 0.8f);
            if (Random.value < Time.deltaTime * 0.25f) ProceduralAudio.Instance.PlayOneShot3D(ProceduralAudio.Instance.MonsterGrowl, transform.position, 0.55f);
        }

        private void DoStunned()
        {
            if (_stateTimer > 2f) SetState(State.Patrol);
        }

        // ---------- Path follow ----------

        private void SetPath(Vector3 target)
        {
            _pathTarget = target;
            var p = _level.Nav.FindPath(transform.position, target);
            _path = p;
            _pathIndex = (p != null && p.Count > 1) ? 1 : 0;
        }

        private bool AtPathEnd() { return _path == null || _pathIndex >= _path.Count; }

        private float _velLen;

        private void FollowPath(float speed)
        {
            if (AtPathEnd()) { _velLen = 0; return; }
            Vector3 wp = _path[_pathIndex];
            Vector3 mp = transform.position;
            Vector3 d = new Vector3(wp.x - mp.x, 0, wp.z - mp.z);
            float dist = d.magnitude;
            if (dist < 0.5f) { _pathIndex++; return; }
            Vector3 dir = d / dist;
            transform.position = mp + dir * speed * Time.deltaTime;
            _velLen = speed;
            // Face velocity
            _yaw = Mathf.LerpAngle(_yaw, Mathf.Atan2(dir.x, dir.z) * Mathf.Rad2Deg, Time.deltaTime * 7f);

            // Footstep audio
            _footTimer -= Time.deltaTime;
            if (_footTimer <= 0f)
            {
                _footTimer = Mathf.Max(0.25f, 0.55f - (speed - 1.5f) * 0.05f);
                ProceduralAudio.Instance.PlayOneShot3D(ProceduralAudio.Instance.MonsterStep, transform.position, 0.85f, 1f, 1f, 35f);
            }
        }

        private void PickAmbushNear(Vector3 pos)
        {
            var c = _level.Nav.WorldToCell(pos.x, pos.z);
            for (int i = 0; i < 30; i++)
            {
                int dx = Random.Range(-3, 4), dy = Random.Range(-3, 4);
                if (_level.Nav.IsWalkable(c.x + dx, c.y + dy))
                {
                    AmbushPos = _level.Nav.CellToWorld(c.x + dx, c.y + dy);
                    AmbushUntil = _globalTimer + 10f + HideScore * 8f;
                    SetPath(AmbushPos);
                    return;
                }
            }
            AmbushPos = pos;
            AmbushUntil = _globalTimer + 8f;
            SetPath(pos);
        }
    }
}
