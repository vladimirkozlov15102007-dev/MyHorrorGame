using System.Collections;
using UnityEngine;

namespace AmberFactory
{
    /// <summary>
    /// Owns the top-level game state (menu / playing / dead / won), instantiates
    /// the level, player, monster, and all subsystems. All assets are generated
    /// procedurally in code (textures, meshes, audio), so no import is needed.
    /// </summary>
    public class GameManager : MonoBehaviour
    {
        public static GameManager I { get; private set; }

        public enum State { Menu, Playing, Dead, Won }
        public State CurrentState { get; private set; } = State.Menu;

        // Core refs
        public LevelBuilder Level { get; private set; }
        public PlayerController Player { get; private set; }
        public Monster Monster { get; private set; }
        public CCTVSystem CCTV { get; private set; }
        public ThrowableSystem Throwables { get; private set; }
        public DynamicMusic Music { get; private set; }
        public AmbientSfx Ambient { get; private set; }
        public HUDController HUD { get; private set; }
        public GameUI UI { get; private set; }

        public Camera PlayerCamera { get; private set; }
        public AudioListener Listener { get; private set; }

        private void Awake()
        {
            if (I != null && I != this) { Destroy(gameObject); return; }
            I = this;
            DontDestroyOnLoad(gameObject);
            BuildWorld();
        }

        private void BuildWorld()
        {
            // --- Audio ---
            Music = gameObject.AddComponent<DynamicMusic>();
            Ambient = gameObject.AddComponent<AmbientSfx>();

            // --- Level ---
            var levelGO = new GameObject("Level");
            levelGO.transform.SetParent(transform, false);
            Level = levelGO.AddComponent<LevelBuilder>();
            Level.Build();

            // --- Player ---
            var playerGO = new GameObject("Player");
            playerGO.transform.SetParent(transform, false);
            playerGO.transform.position = Level.PlayerSpawn;
            Player = playerGO.AddComponent<PlayerController>();
            Player.SetLevel(Level);

            var camGO = new GameObject("PlayerCamera");
            camGO.transform.SetParent(playerGO.transform, false);
            camGO.transform.localPosition = new Vector3(0, 0.65f, 0); // eye offset from capsule base
            PlayerCamera = camGO.AddComponent<Camera>();
            PlayerCamera.fieldOfView = 72f;
            PlayerCamera.nearClipPlane = 0.05f;
            PlayerCamera.farClipPlane = 260f;
            PlayerCamera.backgroundColor = new Color(0.025f, 0.03f, 0.04f, 1f);
            PlayerCamera.clearFlags = CameraClearFlags.SolidColor;
            PlayerCamera.allowHDR = true;

            Listener = camGO.AddComponent<AudioListener>();
            Player.BindCamera(PlayerCamera);

            // Fog for all cameras
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.ExponentialSquared;
            RenderSettings.fogDensity = 0.035f;
            RenderSettings.fogColor = new Color(0.05f, 0.07f, 0.09f, 1f);
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = new Color(0.10f, 0.14f, 0.18f);
            RenderSettings.ambientEquatorColor = new Color(0.06f, 0.08f, 0.10f);
            RenderSettings.ambientGroundColor = new Color(0.03f, 0.03f, 0.04f);

            // --- Monster ---
            var monGO = new GameObject("Monster");
            monGO.transform.SetParent(transform, false);
            Monster = monGO.AddComponent<Monster>();
            Monster.Init(Level, Player);

            // --- CCTV (before Throwables, because ThrowableSystem.UpdateFocus queries CCTV) ---
            var cctvGO = new GameObject("CCTV");
            cctvGO.transform.SetParent(transform, false);
            CCTV = cctvGO.AddComponent<CCTVSystem>();
            CCTV.Init(Level, Player, Monster);

            // --- Throwables ---
            var throwGO = new GameObject("Throwables");
            throwGO.transform.SetParent(transform, false);
            Throwables = throwGO.AddComponent<ThrowableSystem>();
            Throwables.Init(Level, Player, PlayerCamera);

            // --- UI ---
            var uiGO = new GameObject("UI");
            uiGO.transform.SetParent(transform, false);
            UI = uiGO.AddComponent<GameUI>();
            HUD = uiGO.AddComponent<HUDController>();

            // Start in menu
            Player.enabled = false;
            Monster.Pause(true);
            UI.ShowStart();
        }

        public void StartGame()
        {
            ResetWorld();
            CurrentState = State.Playing;
            UI.HideAll();
            Player.enabled = true;
            Monster.Pause(false);
            Cursor.lockState = CursorLockMode.Locked;
            Cursor.visible = false;
            UI.Subtitle("You woke up... you hear it breathing.", 3.5f);
        }

        public void Die(string reason)
        {
            if (CurrentState != State.Playing) return;
            CurrentState = State.Dead;
            Player.enabled = false;
            Monster.Pause(true);
            Cursor.lockState = CursorLockMode.None;
            Cursor.visible = true;
            StartCoroutine(DeathSequence(reason));
        }

        private IEnumerator DeathSequence(string reason)
        {
            UI.ShowJumpscare(true);
            ProceduralAudio.Instance.PlayScreech(transform.position);
            ProceduralAudio.Instance.PlayStinger();
            yield return new WaitForSecondsRealtime(1.6f);
            UI.ShowJumpscare(false);
            UI.ShowDeath(reason);
        }

        public void Win()
        {
            if (CurrentState != State.Playing) return;
            CurrentState = State.Won;
            Player.enabled = false;
            Monster.Pause(true);
            Cursor.lockState = CursorLockMode.None;
            Cursor.visible = true;
            UI.ShowWin();
        }

        private void ResetWorld()
        {
            Player.transform.position = Level.PlayerSpawn;
            Player.ResetState();
            Monster.ResetTo(Level.MonsterSpawn);
            Throwables.ResetAll();
            CCTV.ResetState();
            Level.ResetPickups();
            if (Level.Truck != null) Level.Truck.ResetState();
        }

        private void Update()
        {
            if (CurrentState != State.Playing) return;

            // Truck escape animation & win trigger
            if (Level.Truck != null && Level.Truck.Started)
            {
                Level.Truck.AnimateEscape(Time.deltaTime, Player.transform);
                if (Level.Truck.DriveTimer > 3.5f) Win();
            }
        }
    }
}
