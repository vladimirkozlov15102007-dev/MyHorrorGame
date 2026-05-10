using UnityEngine;
using UnityEngine.UI;

namespace AmberFactory
{
    /// <summary>
    /// In-world HUD: objective, interact prompt, inventory, binoculars overlay,
    /// and damage vignette pulse that tightens when the monster is close.
    /// </summary>
    public class HUDController : MonoBehaviour
    {
        private Canvas _canvas;
        private Text _objective;
        private Text _prompt;
        private Text _subtitle;
        private Text _inventory;
        private Image _vignette;
        private Image _damagePulse;
        private Text _binoZoomText;
        private Text _bottomHints;
        private Text _cctvStatus;

        private float _subtitleTimer;

        private void Start()
        {
            var go = new GameObject("HUDCanvas");
            go.transform.SetParent(transform, false);
            _canvas = go.AddComponent<Canvas>();
            _canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            _canvas.sortingOrder = 10;
            go.AddComponent<CanvasScaler>().uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            go.GetComponent<CanvasScaler>().referenceResolution = new Vector2(1920, 1080);
            go.AddComponent<GraphicRaycaster>();

            // Vignette
            var viGo = new GameObject("Vignette");
            viGo.transform.SetParent(go.transform, false);
            var virt = viGo.AddComponent<RectTransform>();
            virt.anchorMin = Vector2.zero; virt.anchorMax = Vector2.one; virt.offsetMin = Vector2.zero; virt.offsetMax = Vector2.zero;
            var raw = viGo.AddComponent<RawImage>();
            raw.texture = BuildRadialTexture(512, 0.5f, 1.0f, new Color(0, 0, 0, 0.9f));
            raw.color = Color.white;
            raw.raycastTarget = false;

            // Damage pulse
            var dpGo = new GameObject("DamagePulse");
            dpGo.transform.SetParent(go.transform, false);
            var dprt = dpGo.AddComponent<RectTransform>();
            dprt.anchorMin = Vector2.zero; dprt.anchorMax = Vector2.one; dprt.offsetMin = Vector2.zero; dprt.offsetMax = Vector2.zero;
            _damagePulse = dpGo.AddComponent<Image>();
            _damagePulse.color = new Color(0.6f, 0.05f, 0.05f, 0);
            _damagePulse.raycastTarget = false;

            // Objective top-left
            _objective = AddText(go.transform, new Vector2(0, 1), new Vector2(0, 1), new Vector2(14, -12),
                new Vector2(900, 28), 16, TextAnchor.UpperLeft);
            _objective.color = new Color(0.78f, 0.66f, 0.26f);
            _objective.text = "Objective: find 3 keys, reach the YELLOW TRUCK, escape.";

            // Bottom hints bar
            _bottomHints = AddText(go.transform, new Vector2(0, 0), new Vector2(1, 0), new Vector2(14, 18),
                new Vector2(-28, 18), 13, TextAnchor.LowerLeft);
            _bottomHints.color = new Color(0.7f, 0.7f, 0.7f);
            _bottomHints.text = "[WASD] move   [Q] sprint   [CTRL] crouch   [Shift+Wheel] binoculars   [E] interact   [LMB] aim/throw   [G] drop";

            // Inventory bottom-right
            _inventory = AddText(go.transform, new Vector2(1, 0), new Vector2(1, 0), new Vector2(-250, 40),
                new Vector2(240, 24), 14, TextAnchor.LowerRight);
            _inventory.color = new Color(0.95f, 0.82f, 0.36f);
            _inventory.text = "KEYS 0/3";

            // Crosshair dot
            var cross = AddText(go.transform, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), Vector2.zero,
                new Vector2(20, 20), 18, TextAnchor.MiddleCenter);
            cross.text = "·";
            cross.color = new Color(0.9f, 0.9f, 0.9f, 0.55f);

            // Interaction prompt (middle above crosshair)
            _prompt = AddText(go.transform, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), new Vector2(0, 80),
                new Vector2(720, 36), 15, TextAnchor.MiddleCenter);
            _prompt.color = new Color(0.95f, 0.95f, 0.95f);
            _prompt.text = "";

            // Subtitle
            _subtitle = AddText(go.transform, new Vector2(0.5f, 0), new Vector2(0.5f, 0), new Vector2(0, 120),
                new Vector2(900, 40), 17, TextAnchor.MiddleCenter);
            _subtitle.color = new Color(0.8f, 0.8f, 0.8f);
            _subtitle.fontStyle = FontStyle.Italic;
            _subtitle.text = "";

            // Binocular overlay corners
            AddBlackCircle(go.transform);

            _binoZoomText = AddText(go.transform, new Vector2(0.5f, 0.5f), new Vector2(0.5f, 0.5f), new Vector2(0, -200),
                new Vector2(400, 30), 16, TextAnchor.MiddleCenter);
            _binoZoomText.color = new Color(0.8f, 0.2f, 0.2f);
            _binoZoomText.gameObject.SetActive(false);

            // CCTV status line
            _cctvStatus = AddText(go.transform, new Vector2(1, 1), new Vector2(1, 1), new Vector2(-14, -40),
                new Vector2(380, 24), 13, TextAnchor.UpperRight);
            _cctvStatus.color = new Color(0.5f, 0.9f, 0.8f);
            _cctvStatus.text = "";
        }

        private RawImage _binoOverlayRaw;
        private Image AddBlackCircle(Transform parent)
        {
            var go = new GameObject("BinoOverlay");
            go.transform.SetParent(parent, false);
            var rt = go.AddComponent<RectTransform>();
            rt.anchorMin = Vector2.zero; rt.anchorMax = Vector2.one;
            rt.offsetMin = Vector2.zero; rt.offsetMax = Vector2.zero;
            var raw = go.AddComponent<RawImage>();
            raw.texture = BuildBinocularsMaskTexture(512);
            raw.raycastTarget = false;
            _binoOverlayRaw = raw;
            // Return a dummy image on a child so callers get a non-null reference, but keep the root RawImage.
            return null;
        }

        private Text AddText(Transform parent, Vector2 aMin, Vector2 aMax, Vector2 offMin, Vector2 offMax, int size, TextAnchor anchor)
        {
            var go = new GameObject("Text");
            go.transform.SetParent(parent, false);
            var rt = go.AddComponent<RectTransform>();
            rt.anchorMin = aMin; rt.anchorMax = aMax;
            if (aMin == aMax)
            {
                rt.pivot = aMin;
                rt.anchoredPosition = offMin;
                rt.sizeDelta = offMax;
            }
            else
            {
                rt.offsetMin = offMin; rt.offsetMax = offMax;
            }
            var t = go.AddComponent<Text>();
            t.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            t.fontSize = size;
            t.alignment = anchor;
            t.horizontalOverflow = HorizontalWrapMode.Overflow;
            t.verticalOverflow = VerticalWrapMode.Overflow;
            return t;
        }

        private Image AddImage(Transform parent, Vector2 aMin, Vector2 aMax, Vector2 offMin, Vector2 offMax)
        {
            var go = new GameObject("Image");
            go.transform.SetParent(parent, false);
            var rt = go.AddComponent<RectTransform>();
            rt.anchorMin = aMin; rt.anchorMax = aMax;
            rt.offsetMin = offMin; rt.offsetMax = offMax;
            return go.AddComponent<Image>();
        }

        // not used anywhere after cleanup; kept for potential reuse.
        private void _unused_keep() { var _ = _vignette; }

        private Texture2D BuildRadialTexture(int size, float innerRadius, float outerRadius, Color outerColor)
        {
            var t = new Texture2D(size, size, TextureFormat.RGBA32, false);
            var cs = new Color[size * size];
            Vector2 c = new Vector2(size * 0.5f, size * 0.5f);
            for (int y = 0; y < size; y++)
                for (int x = 0; x < size; x++)
                {
                    float d = Vector2.Distance(new Vector2(x, y), c) / (size * 0.5f);
                    float v = Mathf.SmoothStep(0f, 1f, (d - innerRadius) / (outerRadius - innerRadius));
                    cs[y * size + x] = new Color(outerColor.r, outerColor.g, outerColor.b, outerColor.a * v);
                }
            t.SetPixels(cs);
            t.wrapMode = TextureWrapMode.Clamp;
            t.Apply();
            return t;
        }

        private Texture2D BuildBinocularsMaskTexture(int size)
        {
            // Black everywhere except a central circular hole
            var t = new Texture2D(size, size, TextureFormat.RGBA32, false);
            var cs = new Color[size * size];
            Vector2 c = new Vector2(size * 0.5f, size * 0.5f);
            float inner = size * 0.35f;
            float border = size * 0.37f;
            for (int y = 0; y < size; y++)
                for (int x = 0; x < size; x++)
                {
                    float d = Vector2.Distance(new Vector2(x, y), c);
                    if (d < inner) cs[y * size + x] = new Color(0, 0, 0, 0);
                    else if (d < border) cs[y * size + x] = new Color(0.1f, 0.18f, 0.12f, 0.55f);
                    else cs[y * size + x] = new Color(0, 0, 0, 1);
                }
            t.SetPixels(cs);
            t.Apply();
            return t;
        }

        public void Subtitle(string text, float duration)
        {
            _subtitle.text = text;
            _subtitleTimer = duration;
        }

        private void Update()
        {
            var gm = GameManager.I;
            if (gm == null || gm.Player == null) return;

            // Binocular overlay
            bool bino = gm.Player.Binoculars;
            if (_binoOverlayRaw != null) _binoOverlayRaw.gameObject.SetActive(bino);
            _binoZoomText.gameObject.SetActive(bino);
            if (bino) _binoZoomText.text = $"×{gm.Player.BinoZoom:F1}";

            // Prompt
            if (gm.Throwables != null)
            {
                string s = gm.Throwables.CurrentFocus.Label ?? "";
                // Aim charge UI
                if (gm.Throwables.Held != null)
                {
                    if (gm.Throwables.Aiming)
                        s = $"CHARGE {Mathf.RoundToInt(gm.Throwables.Charge * 100)}%   (Release LMB to throw, G to drop)";
                    else if (string.IsNullOrEmpty(s))
                        s = $"Hold LMB to aim {gm.Throwables.Held.Type.ToString().ToUpper()}   (G to drop)";
                }
                _prompt.text = s ?? "";
            }

            // Inventory
            _inventory.text = $"KEYS {gm.Player.KeyCount}/3";

            // Objective
            if (gm.Level.Truck != null && gm.Level.Truck.Active && !gm.Level.Truck.Started)
                _objective.text = "Objective: hold [E] to start the truck — DRIVE!";
            else if (gm.Level.Truck != null && gm.Level.Truck.Started)
                _objective.text = "Objective: DRIVE!";
            else if (gm.Player.KeyCount < 3)
                _objective.text = $"Objective: find truck keys ({gm.Player.KeyCount}/3), then reach the YELLOW TRUCK.";
            else
                _objective.text = "Objective: reach the YELLOW TRUCK in the yard and start it.";

            // CCTV status
            if (gm.CCTV != null)
            {
                if (gm.CCTV.Active) _cctvStatus.text = $"CCTV ONLINE  {Mathf.CeilToInt(gm.CCTV.TimeLeft)}s";
                else if (gm.CCTV.Cooldown > 0f) _cctvStatus.text = $"CCTV COOLING  {Mathf.CeilToInt(gm.CCTV.Cooldown)}s";
                else _cctvStatus.text = "CCTV READY";
            }

            // Subtitle timer
            if (_subtitleTimer > 0)
            {
                _subtitleTimer -= Time.deltaTime;
                if (_subtitleTimer <= 0) _subtitle.text = "";
            }

            // Damage pulse
            float dist = gm.Monster != null ? Vector3.Distance(gm.Player.transform.position, gm.Monster.transform.position) : 999f;
            float tension = 0f;
            if (dist < 12f) tension = 1f - dist / 12f;
            if (gm.Monster != null && gm.Monster.IsChasing) tension = Mathf.Max(tension, 0.8f);
            float pulse = Mathf.Sin(Time.time * 6f) * 0.5f + 0.5f;
            _damagePulse.color = new Color(0.7f, 0.05f, 0.05f, tension * pulse * 0.45f);
        }
    }
}
