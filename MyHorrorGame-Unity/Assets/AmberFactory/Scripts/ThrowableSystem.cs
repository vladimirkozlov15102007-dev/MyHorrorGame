using System.Collections.Generic;
using UnityEngine;

namespace AmberFactory
{
    /// <summary>
    /// Handles:
    ///  - detecting nearest throwable/key/locker/terminal and exposing a prompt
    ///  - picking things up (E)
    ///  - aiming (hold LMB, charge grows while held, crosshair widens)
    ///  - releasing the throw (LMB up → spawns Projectile)
    ///  - Noise events pushed to the Monster.
    /// </summary>
    public class ThrowableSystem : MonoBehaviour
    {
        public enum FocusKind { None, Throwable, Key, LockerEnter, LockerExit, Terminal, Truck, TruckLocked }

        public struct Focus
        {
            public FocusKind Kind;
            public Throwable Throwable;
            public Pickup Key;
            public HidingSpot Locker;
            public SecurityTerminal Terminal;
            public TruckStarter Truck;
            public string Label;
        }

        private LevelBuilder _level;
        private PlayerController _player;
        private Camera _cam;

        public Focus CurrentFocus;
        public Throwable Held { get; private set; }
        public GameObject HeldVisual { get; private set; }

        public bool Aiming;
        public float Charge; // 0..1

        public List<NoiseEvent> Noises = new List<NoiseEvent>();

        public struct NoiseEvent { public Vector3 Pos; public float Loudness; public float Time; }

        public void Init(LevelBuilder level, PlayerController player, Camera cam)
        {
            _level = level; _player = player; _cam = cam;
        }

        public void ResetAll()
        {
            if (HeldVisual) Destroy(HeldVisual);
            Held = null;
            Aiming = false;
            Charge = 0;
            CurrentFocus = default;
            Noises.Clear();
        }

        private void Update()
        {
            if (GameManager.I.CurrentState != GameManager.State.Playing) return;

            UpdateFocus();
            UpdateHandVisual();
            UpdateInput();
            UpdateAimCharge();
        }

        private void UpdateFocus()
        {
            CurrentFocus = default;
            if (_player.InputSuppressed || !_player.CanMove)
            {
                if (_player.Hidden && _player.CurrentHideSpot != null)
                {
                    CurrentFocus.Kind = FocusKind.LockerExit;
                    CurrentFocus.Locker = _player.CurrentHideSpot;
                    CurrentFocus.Label = "EXIT LOCKER [E]";
                }
                return;
            }
            if (_player.Hidden && _player.CurrentHideSpot != null)
            {
                CurrentFocus.Kind = FocusKind.LockerExit;
                CurrentFocus.Locker = _player.CurrentHideSpot;
                CurrentFocus.Label = "EXIT LOCKER [E]";
                return;
            }

            Vector3 p = _player.transform.position;
            float best = 2.4f;

            // Terminal
            if (_level.SecurityTerm != null && _level.SecurityTerm.InRange(p))
            {
                float d = Vector3.Distance(p, _level.SecurityTerm.InteractPos);
                if (d < best) { best = d; CurrentFocus = new Focus { Kind = FocusKind.Terminal, Terminal = _level.SecurityTerm, Label = GameManager.I.CCTV.canActivate() ? "VIEW CAMERAS [E]" : $"CAMERAS COOLDOWN {(int)GameManager.I.CCTV.Cooldown}s" }; }
            }

            // Truck
            if (_level.Truck != null)
            {
                float d = Vector3.Distance(p, _level.Truck.InteractPos);
                if (d < 3f && d < best)
                {
                    best = d;
                    if (_player.KeyCount >= 3)
                    {
                        CurrentFocus = new Focus { Kind = FocusKind.Truck, Truck = _level.Truck, Label = _level.Truck.CurrentStepLabel(_player.KeyCount) };
                    }
                    else
                    {
                        CurrentFocus = new Focus { Kind = FocusKind.TruckLocked, Truck = _level.Truck, Label = _level.Truck.CurrentStepLabel(_player.KeyCount) };
                    }
                }
            }

            // Keys
            foreach (var k in _level.Keys)
            {
                if (k.Collected) continue;
                float d = Vector3.Distance(p, k.transform.position);
                if (d < best) { best = d; CurrentFocus = new Focus { Kind = FocusKind.Key, Key = k, Label = $"PICK UP KEY [E] ({_player.KeyCount}/3)" }; }
            }

            // Throwables
            foreach (var t in _level.Throwables)
            {
                if (t.Collected) continue;
                float d = Vector3.Distance(p, t.transform.position);
                if (d < best && Held == null)
                {
                    best = d;
                    CurrentFocus = new Focus { Kind = FocusKind.Throwable, Throwable = t, Label = $"PICK UP {t.Type.ToString().ToUpper()} [E]" };
                }
            }

            // Lockers
            foreach (var l in _level.HidingSpots)
            {
                if (l.Occupied) continue;
                float d = Vector3.Distance(p, l.EntryWorldPos);
                if (d < best) { best = d; CurrentFocus = new Focus { Kind = FocusKind.LockerEnter, Locker = l, Label = "HIDE IN LOCKER [E]" }; }
            }
        }

        private void UpdateInput()
        {
            // E
            if (Input.GetKeyDown(KeyCode.E))
            {
                var f = CurrentFocus;
                switch (f.Kind)
                {
                    case FocusKind.Throwable:
                        if (Held == null)
                        {
                            Held = f.Throwable;
                            Held.Collect();
                            CreateHandVisual();
                            ProceduralAudio.Instance.PlayOneShot2D(ProceduralAudio.Instance.Pickup, 0.7f);
                        }
                        break;
                    case FocusKind.Key:
                        f.Key.Collect();
                        _player.KeyCount++;
                        ProceduralAudio.Instance.PlayOneShot2D(ProceduralAudio.Instance.KeyPickup, 0.8f);
                        GameManager.I.UI.Subtitle($"Key {_player.KeyCount}/3", 2f);
                        if (_player.KeyCount >= 3) GameManager.I.UI.Subtitle("All keys found — reach the YELLOW TRUCK.", 3f);
                        break;
                    case FocusKind.LockerEnter:
                        _player.Hide(f.Locker);
                        break;
                    case FocusKind.LockerExit:
                        _player.Unhide();
                        break;
                    case FocusKind.Terminal:
                        if (GameManager.I.CCTV.canActivate())
                            GameManager.I.CCTV.Activate();
                        break;
                    case FocusKind.Truck:
                        if (!f.Truck.Active) f.Truck.TryStartActivate(_player.KeyCount);
                        break;
                }
            }
            // Hold E to crank truck
            if (Input.GetKey(KeyCode.E))
            {
                if (CurrentFocus.Kind == FocusKind.Truck && CurrentFocus.Truck.Active && !CurrentFocus.Truck.Started)
                    CurrentFocus.Truck.HoldProgress(Time.deltaTime);
            }

            // Drop held item with G
            if (Held != null && Input.GetKeyDown(KeyCode.G))
            {
                DropHeld();
            }

            // Throw: LMB down → aim, LMB up → throw
            if (Held != null && !_player.Hidden && !_player.InputSuppressed)
            {
                if (Input.GetMouseButtonDown(0) && !Aiming)
                {
                    Aiming = true;
                    Charge = 0;
                }
                if (Input.GetMouseButtonUp(0) && Aiming)
                {
                    Aiming = false;
                    LaunchHeld(Mathf.Max(0.2f, Charge));
                }
            }
            else
            {
                if (Input.GetMouseButtonUp(0)) { Aiming = false; Charge = 0; }
            }
        }

        private void UpdateAimCharge()
        {
            if (Aiming) Charge = Mathf.Min(1f, Charge + Time.deltaTime * 0.8f);
        }

        private void CreateHandVisual()
        {
            if (HeldVisual) Destroy(HeldVisual);
            var root = new GameObject("Held");
            root.transform.SetParent(_cam.transform, false);
            var mf = root.AddComponent<MeshFilter>();
            var mr = root.AddComponent<MeshRenderer>();
            mf.sharedMesh = Held.Mesh;
            mr.sharedMaterial = new Material(Held.Material);
            root.transform.localScale = Held.HoldScale;
            HeldVisual = root;
        }

        private void UpdateHandVisual()
        {
            if (HeldVisual == null) return;
            bool aim = Aiming;
            float aimFwd = aim ? 0.5f : 0.55f;
            float aimRight = aim ? 0.15f : 0.32f;
            float aimDown = aim ? -0.2f : -0.32f;
            float bobAmt = Mathf.Sin(Time.time * 3f) * (aim ? 0.015f : 0.006f);
            Vector3 local = new Vector3(aimRight, aimDown + bobAmt, aimFwd);

            HeldVisual.transform.localPosition = Vector3.Lerp(HeldVisual.transform.localPosition, local, Time.deltaTime * 12f);
            Quaternion rot = Quaternion.Euler(20, -10, -5);
            // Pipes/rebars lie horizontally
            if (Held != null && (Held.Type == LevelBuilder.ThrowableType.Pipe || Held.Type == LevelBuilder.ThrowableType.Rebar))
                rot = Quaternion.Euler(80, 10, 0);
            if (aim)
            {
                // Small swaying while aiming
                rot *= Quaternion.Euler(Mathf.Sin(Time.time * 2.1f) * 2.5f, Mathf.Cos(Time.time * 1.7f) * 2.5f, 0);
            }
            HeldVisual.transform.localRotation = Quaternion.Slerp(HeldVisual.transform.localRotation, rot, Time.deltaTime * 12f);
        }

        private void DropHeld()
        {
            if (Held == null) return;
            // Place it at feet and reactivate
            Held.transform.position = _player.transform.position + _player.LookDir * 0.3f;
            Held.gameObject.SetActive(true);
            Held.Collected = false;
            Destroy(HeldVisual);
            HeldVisual = null;
            Held = null;
        }

        private void LaunchHeld(float charge)
        {
            if (Held == null || HeldVisual == null) return;
            Vector3 dir = _player.LookDir.normalized;
            Vector3 origin = _cam.transform.position + dir * 0.5f + Vector3.down * 0.1f;
            float speed = Mathf.Lerp(7f, 22f, charge);

            var proj = new GameObject($"Projectile_{Held.Type}");
            proj.transform.position = origin;
            var mf = proj.AddComponent<MeshFilter>();
            var mr = proj.AddComponent<MeshRenderer>();
            mf.sharedMesh = Held.Mesh;
            mr.sharedMaterial = new Material(Held.Material);
            proj.transform.localScale = Held.HoldScale;
            var p = proj.AddComponent<Projectile>();
            p.Init(this, Held, dir * speed + Vector3.up * charge * 2.5f);

            ProceduralAudio.Instance.PlayOneShot2D(ProceduralAudio.Instance.Whoosh, 0.6f);

            Destroy(HeldVisual); HeldVisual = null;
            Held = null;
        }

        public void EmitNoise(Vector3 pos, float loudness)
        {
            Noises.Add(new NoiseEvent { Pos = pos, Loudness = loudness, Time = Time.time });
        }

        public List<NoiseEvent> PopNoises()
        {
            var copy = new List<NoiseEvent>(Noises);
            Noises.Clear();
            return copy;
        }
    }
}
