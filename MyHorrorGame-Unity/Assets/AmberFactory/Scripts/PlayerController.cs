using UnityEngine;

namespace AmberFactory
{
    /// <summary>
    /// First-person controller. No flashlight (per spec).
    /// Binoculars are activated by HOLDING Shift; mouse wheel sets zoom 1× → 8×.
    /// </summary>
    [RequireComponent(typeof(CharacterController))]
    public class PlayerController : MonoBehaviour
    {
        private const float EYE_HEIGHT = 1.65f;
        private const float CROUCH_HEIGHT = 1.05f;

        public float MouseSens = 2.0f;
        public float WalkSpeed = 3.4f;
        public float SprintSpeed = 5.6f;
        public float CrouchSpeed = 1.6f;
        public float BinocularSpeed = 1.2f;

        [HideInInspector] public Vector3 MoveDir; // world-space move requested
        [HideInInspector] public bool Crouching;
        [HideInInspector] public bool Sprinting;
        [HideInInspector] public bool Binoculars;
        [HideInInspector] public float BinoZoom = 1f; // 1..8
        [HideInInspector] public bool Hidden;
        [HideInInspector] public HidingSpot CurrentHideSpot;
        [HideInInspector] public int KeyCount;

        public bool CanMove = true;           // CCTV mode + death + win disable movement
        public bool InputSuppressed = false;  // while CCTV open, suppress throw input etc.

        public float NoiseThisFrame;          // 0..1 broadcast to monster each frame
        public Vector3 NoisePos;
        public float TimesHidden;             // adaptive counter
        public float SprintSeconds;           // adaptive counter

        private CharacterController _cc;
        private Camera _cam;
        private float _yaw, _pitch;
        private float _verticalVel;
        private float _stepTimer;
        private float _yawCameraRollTarget;
        private float _bob;

        // Binocular camera FOVs
        private const float DefaultFOV = 72f;

        private LevelBuilder _level;

        private void Awake()
        {
            _cc = GetComponent<CharacterController>();
            _cc.height = EYE_HEIGHT + 0.2f;
            _cc.radius = 0.32f;
            _cc.center = new Vector3(0, (EYE_HEIGHT + 0.2f) * 0.5f, 0);
            _cc.slopeLimit = 50f;
            _cc.stepOffset = 0.3f;
        }

        public void SetLevel(LevelBuilder level) { _level = level; }
        public void BindCamera(Camera cam) { _cam = cam; cam.fieldOfView = DefaultFOV; }

        public void ResetState()
        {
            Crouching = false; Sprinting = false; Binoculars = false;
            BinoZoom = 1f; Hidden = false; CurrentHideSpot = null;
            KeyCount = 0; TimesHidden = 0; SprintSeconds = 0;
            _yaw = 0; _pitch = 0; _verticalVel = 0;
            CanMove = true; InputSuppressed = false;
        }

        private void Update()
        {
            HandleMouseLook();
            HandleBinoculars();
            HandleMovement();
            HandleCameraPose();
            EmitNoise();
        }

        private void HandleMouseLook()
        {
            if (!CanMove) return;
            float mx = Input.GetAxisRaw("Mouse X");
            float my = Input.GetAxisRaw("Mouse Y");
            // Dampen when using binoculars for sniper-like feel
            float binoMul = Binoculars ? (1f / Mathf.Lerp(1f, 3.5f, (BinoZoom - 1f) / 7f)) : 1f;
            _yaw += mx * MouseSens * binoMul;
            _pitch -= my * MouseSens * binoMul;
            _pitch = Mathf.Clamp(_pitch, -89f, 89f);
        }

        private void HandleBinoculars()
        {
            bool holding = (Input.GetKey(KeyCode.LeftShift) || Input.GetKey(KeyCode.RightShift))
                            && !Hidden && CanMove;
            if (holding != Binoculars)
            {
                Binoculars = holding;
                // click sound
                ProceduralAudio.Instance.PlayOneShot2D(ProceduralAudio.Instance.Pickup, 0.3f);
                if (!Binoculars) BinoZoom = 1f;
            }
            if (Binoculars)
            {
                float wheel = Input.GetAxis("Mouse ScrollWheel");
                if (Mathf.Abs(wheel) > 0.001f)
                {
                    BinoZoom = Mathf.Clamp(BinoZoom + wheel * 8f, 1f, 8f);
                }
            }
            // FOV: 72° at 1×, down to ~9° at 8×
            if (_cam != null)
            {
                float target = Binoculars ? (DefaultFOV / BinoZoom) : DefaultFOV;
                _cam.fieldOfView = Mathf.Lerp(_cam.fieldOfView, target, Time.deltaTime * 10f);
            }
        }

        private void HandleMovement()
        {
            if (!CanMove || Hidden)
            {
                _cc.enabled = false;
                return;
            }
            if (!_cc.enabled) _cc.enabled = true;

            float h = Input.GetAxisRaw("Horizontal");
            float v = Input.GetAxisRaw("Vertical");
            bool wantCrouch = Input.GetKey(KeyCode.LeftControl) || Input.GetKey(KeyCode.C);
            // Sprint requires NOT holding Shift-for-binoculars → so we use left-Alt? Actually per spec
            // shift is binoculars. Use Shift when NOT binoculars is problematic, so we use W held at full speed by default
            // when no extra modifier. Spec says "running" adapts AI; we'll keep sprint on Q to avoid conflict.
            bool wantSprint = Input.GetKey(KeyCode.Q);
            Crouching = wantCrouch;
            Sprinting = wantSprint && !Binoculars && !wantCrouch && (Mathf.Abs(h) + Mathf.Abs(v) > 0.1f);

            if (Sprinting) SprintSeconds += Time.deltaTime;

            float speed = WalkSpeed;
            if (Crouching) speed = CrouchSpeed;
            else if (Sprinting) speed = SprintSpeed;
            if (Binoculars) speed = BinocularSpeed;

            // Yaw to world forward
            float yr = _yaw * Mathf.Deg2Rad;
            Vector3 fwd = new Vector3(Mathf.Sin(yr), 0, Mathf.Cos(yr));
            Vector3 right = new Vector3(fwd.z, 0, -fwd.x);
            Vector3 dir = (fwd * v + right * h).normalized;
            MoveDir = dir;

            // Simple gravity
            _verticalVel -= 20f * Time.deltaTime;
            if (_cc.isGrounded && _verticalVel < 0) _verticalVel = -2f;

            _cc.Move(dir * speed * Time.deltaTime + Vector3.up * _verticalVel * Time.deltaTime);

            // Footstep audio
            if (dir.sqrMagnitude > 0.01f)
            {
                float interval = Sprinting ? 0.32f : Crouching ? 0.75f : 0.5f;
                _stepTimer -= Time.deltaTime;
                if (_stepTimer <= 0f)
                {
                    _stepTimer = interval;
                    var clip = Crouching ? ProceduralAudio.Instance.PlayerStepSoft : ProceduralAudio.Instance.PlayerStep;
                    ProceduralAudio.Instance.PlayOneShot3D(clip, transform.position + Vector3.up * 0.1f, Sprinting ? 1.4f : 1f);
                    _bob = 1f;
                }
            }
            else _stepTimer = 0.1f;
        }

        private void HandleCameraPose()
        {
            transform.rotation = Quaternion.Euler(0, _yaw, 0);
            if (_cam == null) return;
            float targetY = Crouching ? CROUCH_HEIGHT : EYE_HEIGHT;
            var local = _cam.transform.localPosition;
            local.y = Mathf.Lerp(local.y, targetY - (_cc.height * 0.5f) + 0.05f, Time.deltaTime * 10f);
            // Head bob (only when moving & not using binoculars)
            float bobAmt = 0f;
            if (_cc.velocity.sqrMagnitude > 0.1f && !Binoculars)
            {
                float f = Sprinting ? 9f : 6f;
                bobAmt = Mathf.Sin(Time.time * f) * 0.015f;
            }
            _bob = Mathf.Lerp(_bob, 0f, Time.deltaTime * 4f);
            local.y += bobAmt;
            _cam.transform.localPosition = local;
            _cam.transform.localRotation = Quaternion.Euler(_pitch, 0, bobAmt * 40f);
        }

        private void EmitNoise()
        {
            if (Hidden || Binoculars || !CanMove) { NoiseThisFrame = 0; return; }
            if (MoveDir.sqrMagnitude < 0.01f) { NoiseThisFrame = 0; return; }
            if (Sprinting) NoiseThisFrame = 1.0f;
            else if (Crouching) NoiseThisFrame = 0.12f;
            else NoiseThisFrame = 0.45f;
            NoisePos = transform.position;
        }

        public void Hide(HidingSpot spot)
        {
            if (Hidden || spot == null) return;
            Hidden = true;
            CurrentHideSpot = spot;
            spot.Occupied = true;
            spot.PlayOpen();
            ProceduralAudio.Instance.PlayOneShot3D(ProceduralAudio.Instance.LockerOpen, spot.transform.position);
            transform.position = spot.transform.position + Vector3.up * 1.0f;
            TimesHidden++;
        }

        public void Unhide()
        {
            if (!Hidden || CurrentHideSpot == null) return;
            CurrentHideSpot.Occupied = false;
            CurrentHideSpot.PlayOpen();
            ProceduralAudio.Instance.PlayOneShot3D(ProceduralAudio.Instance.LockerOpen, CurrentHideSpot.transform.position);
            transform.position = CurrentHideSpot.EntryWorldPos;
            Hidden = false;
            CurrentHideSpot = null;
        }

        public Vector3 LookDir
        {
            get
            {
                float yr = _yaw * Mathf.Deg2Rad;
                float pr = _pitch * Mathf.Deg2Rad;
                return new Vector3(Mathf.Sin(yr) * Mathf.Cos(pr), -Mathf.Sin(pr), Mathf.Cos(yr) * Mathf.Cos(pr));
            }
        }

        public float Yaw => _yaw;
        public float Pitch => _pitch;
        public Camera Cam => _cam;
    }
}
