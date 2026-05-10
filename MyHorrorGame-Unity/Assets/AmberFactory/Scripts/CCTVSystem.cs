using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

namespace AmberFactory
{
    /// <summary>
    /// Security CCTV. 4 off-screen cameras render into RenderTextures.
    /// When activated, a split-screen overlay shows the live feeds; the player
    /// is frozen in place. System runs for 30s then needs 75s cooldown.
    /// </summary>
    public class CCTVSystem : MonoBehaviour
    {
        public float Duration = 30f;
        public float CooldownDuration = 75f;

        public bool Active { get; private set; }
        public float TimeLeft { get; private set; }
        public float Cooldown { get; private set; }

        public bool canActivate() => !Active && Cooldown <= 0f;

        private LevelBuilder _level;
        private PlayerController _player;
        private Monster _monster;

        private List<Camera> _cams = new List<Camera>();
        private List<RenderTexture> _rts = new List<RenderTexture>();

        // UI
        private Canvas _canvas;
        private GameObject _root;
        private RawImage[] _views = new RawImage[4];
        private Text _label0, _label1, _label2, _label3;
        private Text _timerText;
        private Text _recText;
        private Text _cooldownText;
        private Text _hintText;

        public void Init(LevelBuilder level, PlayerController player, Monster monster)
        {
            _level = level; _player = player; _monster = monster;
            BuildCamerasFromLevel();
            BuildUI();
        }

        public void ResetState()
        {
            if (Active) Deactivate();
            Cooldown = 0f;
        }

        private void BuildCamerasFromLevel()
        {
            // Take first 4 CCTV specs
            for (int i = 0; i < Mathf.Min(4, _level.CCTVCameras.Count); i++)
            {
                var s = _level.CCTVCameras[i];
                var go = new GameObject($"CCTVCam_{i}");
                go.transform.SetParent(transform, false);
                go.transform.position = s.Position;
                go.transform.LookAt(s.LookAt);
                var cam = go.AddComponent<Camera>();
                cam.enabled = false; // render manually
                cam.fieldOfView = 78f;
                cam.nearClipPlane = 0.1f;
                cam.farClipPlane = 120f;
                cam.clearFlags = CameraClearFlags.SolidColor;
                cam.backgroundColor = new Color(0.01f, 0.015f, 0.02f);

                var rt = new RenderTexture(512, 384, 16, RenderTextureFormat.ARGB32);
                rt.Create();
                cam.targetTexture = rt;
                _cams.Add(cam);
                _rts.Add(rt);
            }
        }

        private void BuildUI()
        {
            var canGo = new GameObject("CCTVCanvas");
            canGo.transform.SetParent(transform, false);
            _canvas = canGo.AddComponent<Canvas>();
            _canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            _canvas.sortingOrder = 50;
            canGo.AddComponent<CanvasScaler>().uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            canGo.GetComponent<CanvasScaler>().referenceResolution = new Vector2(1920, 1080);
            canGo.AddComponent<GraphicRaycaster>();

            _root = new GameObject("CCTVRoot");
            _root.transform.SetParent(canGo.transform, false);
            var rt = _root.AddComponent<RectTransform>();
            rt.anchorMin = Vector2.zero; rt.anchorMax = Vector2.one;
            rt.offsetMin = Vector2.zero; rt.offsetMax = Vector2.zero;
            _root.AddComponent<Image>().color = new Color(0, 0, 0, 1f);
            _root.SetActive(false);

            // Split-screen RawImages
            Vector2[] centers = {
                new Vector2(0.25f, 0.75f), new Vector2(0.75f, 0.75f),
                new Vector2(0.25f, 0.25f), new Vector2(0.75f, 0.25f)
            };
            Text[] labels = new Text[4];
            for (int i = 0; i < 4; i++)
            {
                var imgGo = new GameObject($"View_{i}");
                imgGo.transform.SetParent(_root.transform, false);
                var irt = imgGo.AddComponent<RectTransform>();
                irt.anchorMin = centers[i] - new Vector2(0.245f, 0.24f);
                irt.anchorMax = centers[i] + new Vector2(0.245f, 0.24f);
                irt.offsetMin = Vector2.zero; irt.offsetMax = Vector2.zero;
                var raw = imgGo.AddComponent<RawImage>();
                if (i < _rts.Count) raw.texture = _rts[i];
                else raw.color = Color.black;
                _views[i] = raw;

                // Scanlines / noise overlay
                var scanGo = new GameObject("Scan");
                scanGo.transform.SetParent(imgGo.transform, false);
                var srt = scanGo.AddComponent<RectTransform>();
                srt.anchorMin = Vector2.zero; srt.anchorMax = Vector2.one;
                srt.offsetMin = Vector2.zero; srt.offsetMax = Vector2.zero;
                var scanImg = scanGo.AddComponent<RawImage>();
                scanImg.texture = BuildScanlineTexture();
                scanImg.color = new Color(0.8f, 1f, 0.85f, 0.25f);
                scanImg.raycastTarget = false;

                // Static
                var noiseGo = new GameObject("Noise");
                noiseGo.transform.SetParent(imgGo.transform, false);
                var nrt = noiseGo.AddComponent<RectTransform>();
                nrt.anchorMin = Vector2.zero; nrt.anchorMax = Vector2.one;
                nrt.offsetMin = Vector2.zero; nrt.offsetMax = Vector2.zero;
                var noiseImg = noiseGo.AddComponent<RawImage>();
                noiseImg.texture = BuildStaticTexture(0);
                noiseImg.color = new Color(1, 1, 1, 0.12f);
                noiseImg.raycastTarget = false;

                // Label
                var lblGo = new GameObject("Label");
                lblGo.transform.SetParent(imgGo.transform, false);
                var lrt = lblGo.AddComponent<RectTransform>();
                lrt.anchorMin = new Vector2(0, 1); lrt.anchorMax = new Vector2(1, 1);
                lrt.pivot = new Vector2(0.5f, 1);
                lrt.sizeDelta = new Vector2(0, 28);
                lrt.anchoredPosition = new Vector2(0, -4);
                var lbl = lblGo.AddComponent<Text>();
                lbl.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
                lbl.fontSize = 16;
                lbl.alignment = TextAnchor.MiddleLeft;
                lbl.color = new Color(0.7f, 1f, 0.85f);
                lbl.text = i < _level.CCTVCameras.Count ? _level.CCTVCameras[i].Label : $"CAM 0{i + 1}";
                lbl.horizontalOverflow = HorizontalWrapMode.Overflow;
                lbl.supportRichText = true;
                labels[i] = lbl;
            }
            _label0 = labels[0]; _label1 = labels[1]; _label2 = labels[2]; _label3 = labels[3];

            // Top bar
            var topGo = new GameObject("TopBar");
            topGo.transform.SetParent(_root.transform, false);
            var trt = topGo.AddComponent<RectTransform>();
            trt.anchorMin = new Vector2(0, 1); trt.anchorMax = new Vector2(1, 1);
            trt.pivot = new Vector2(0.5f, 1);
            trt.sizeDelta = new Vector2(0, 36);
            trt.anchoredPosition = Vector2.zero;
            topGo.AddComponent<Image>().color = new Color(0, 0, 0, 0.85f);

            var titleGo = new GameObject("Title");
            titleGo.transform.SetParent(topGo.transform, false);
            var tirt = titleGo.AddComponent<RectTransform>();
            tirt.anchorMin = new Vector2(0, 0); tirt.anchorMax = new Vector2(0.5f, 1);
            tirt.offsetMin = new Vector2(14, 0); tirt.offsetMax = new Vector2(-14, 0);
            var title = titleGo.AddComponent<Text>();
            title.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            title.fontSize = 16;
            title.color = new Color(0.9f, 0.76f, 0.2f);
            title.alignment = TextAnchor.MiddleLeft;
            title.text = "AMBER FACTORY — SECURITY SYSTEM — CH 01/04";

            var recGo = new GameObject("Rec");
            recGo.transform.SetParent(topGo.transform, false);
            var rrt = recGo.AddComponent<RectTransform>();
            rrt.anchorMin = new Vector2(0.5f, 0); rrt.anchorMax = new Vector2(1, 1);
            rrt.offsetMin = new Vector2(0, 0); rrt.offsetMax = new Vector2(-14, 0);
            _recText = recGo.AddComponent<Text>();
            _recText.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            _recText.fontSize = 16;
            _recText.color = new Color(1f, 0.22f, 0.22f);
            _recText.alignment = TextAnchor.MiddleRight;
            _recText.text = "● REC  00:30";

            // Hint
            var hintGo = new GameObject("Hint");
            hintGo.transform.SetParent(_root.transform, false);
            var hrt = hintGo.AddComponent<RectTransform>();
            hrt.anchorMin = new Vector2(0, 0); hrt.anchorMax = new Vector2(1, 0);
            hrt.pivot = new Vector2(0.5f, 0); hrt.sizeDelta = new Vector2(0, 26);
            hrt.anchoredPosition = Vector2.zero;
            hintGo.AddComponent<Image>().color = new Color(0, 0, 0, 0.75f);
            var hgt = new GameObject("Hint2");
            hgt.transform.SetParent(hintGo.transform, false);
            var hrt2 = hgt.AddComponent<RectTransform>();
            hrt2.anchorMin = Vector2.zero; hrt2.anchorMax = Vector2.one;
            hrt2.offsetMin = new Vector2(14, 0); hrt2.offsetMax = new Vector2(-14, 0);
            _hintText = hgt.AddComponent<Text>();
            _hintText.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            _hintText.fontSize = 13;
            _hintText.color = new Color(0.85f, 0.85f, 0.85f);
            _hintText.alignment = TextAnchor.MiddleLeft;
            _hintText.text = "PRESS [E] TO EXIT  ·  YOU CANNOT MOVE";
        }

        private Texture2D BuildScanlineTexture()
        {
            var t = new Texture2D(2, 128, TextureFormat.RGBA32, false, false);
            var cs = new Color32[2 * 128];
            for (int y = 0; y < 128; y++)
            {
                byte a = (byte)((y % 3 == 0) ? 120 : 0);
                cs[y * 2] = new Color32(0, 60, 40, a);
                cs[y * 2 + 1] = new Color32(0, 60, 40, a);
            }
            t.SetPixels32(cs);
            t.filterMode = FilterMode.Point;
            t.wrapMode = TextureWrapMode.Repeat;
            t.Apply();
            return t;
        }

        private Texture2D BuildStaticTexture(int seed)
        {
            var t = new Texture2D(128, 128, TextureFormat.R8, false, false);
            var cs = new Color[128 * 128];
            for (int i = 0; i < cs.Length; i++)
            {
                float v = Random.value;
                cs[i] = new Color(v, v, v, v);
            }
            t.SetPixels(cs);
            t.filterMode = FilterMode.Point;
            t.Apply();
            return t;
        }

        public void Activate()
        {
            if (!canActivate()) return;
            Active = true;
            TimeLeft = Duration;
            _player.CanMove = false;
            _player.InputSuppressed = true;
            _root.SetActive(true);
            Cursor.lockState = CursorLockMode.None;
            Cursor.visible = false; // still hidden, but cannot look
            ProceduralAudio.Instance.PlayOneShot2D(ProceduralAudio.Instance.CCTVBoot, 0.9f);
        }

        public void Deactivate()
        {
            if (!Active) return;
            Active = false;
            Cooldown = CooldownDuration;
            _player.CanMove = true;
            _player.InputSuppressed = false;
            _root.SetActive(false);
            Cursor.lockState = CursorLockMode.Locked;
            ProceduralAudio.Instance.PlayOneShot2D(ProceduralAudio.Instance.CCTVShutdown, 0.8f);
        }

        private void Update()
        {
            if (Active)
            {
                TimeLeft -= Time.deltaTime;
                if (TimeLeft <= 0f) { Deactivate(); return; }

                // Exit on E
                if (Input.GetKeyDown(KeyCode.E)) { Deactivate(); return; }

                // Render cameras
                for (int i = 0; i < _cams.Count; i++) _cams[i].Render();

                // Static refresh
                foreach (var v in _views)
                {
                    if (v != null)
                    {
                        var static1 = v.transform.Find("Noise");
                        if (static1 != null) static1.GetComponent<RawImage>().color = new Color(1, 1, 1, Random.Range(0.08f, 0.2f));
                    }
                }

                // REC timer update
                int t = Mathf.Max(0, Mathf.CeilToInt(TimeLeft));
                string mm = (t / 60).ToString("D2");
                string ss = (t % 60).ToString("D2");
                bool flash = Mathf.Sin(Time.time * 6f) > 0;
                _recText.text = (flash ? "● " : "  ") + "REC  " + mm + ":" + ss;

                // CCTV static chirp
                if (Random.value < Time.deltaTime * 0.7f)
                    ProceduralAudio.Instance.PlayOneShot2D(ProceduralAudio.Instance.CCTVStatic, 0.15f);
            }
            else if (Cooldown > 0f)
            {
                Cooldown = Mathf.Max(0f, Cooldown - Time.deltaTime);
            }
        }

        private void OnDestroy()
        {
            foreach (var rt in _rts) if (rt) rt.Release();
        }
    }
}
