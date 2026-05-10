using UnityEngine;
using UnityEngine.UI;

namespace AmberFactory
{
    /// <summary>
    /// Full-screen overlays: Start menu, Death, Win, Jumpscare.
    /// </summary>
    public class GameUI : MonoBehaviour
    {
        private Canvas _canvas;
        private GameObject _startPanel, _deathPanel, _winPanel, _jumpscarePanel;
        private Text _deathText;
        private HUDController _hud;

        private void Start()
        {
            var go = new GameObject("UICanvas");
            go.transform.SetParent(transform, false);
            _canvas = go.AddComponent<Canvas>();
            _canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            _canvas.sortingOrder = 100;
            go.AddComponent<CanvasScaler>().uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            go.GetComponent<CanvasScaler>().referenceResolution = new Vector2(1920, 1080);
            go.AddComponent<GraphicRaycaster>();

            _startPanel = BuildStartPanel(go.transform);
            _deathPanel = BuildDeathPanel(go.transform);
            _winPanel = BuildWinPanel(go.transform);
            _jumpscarePanel = BuildJumpscarePanel(go.transform);

            _deathPanel.SetActive(false);
            _winPanel.SetActive(false);
            _jumpscarePanel.SetActive(false);

            _hud = GetComponent<HUDController>();
        }

        public void Subtitle(string s, float dur = 2.5f)
        {
            if (_hud == null) _hud = GetComponent<HUDController>();
            if (_hud != null) _hud.Subtitle(s, dur);
        }

        private GameObject BuildStartPanel(Transform parent)
        {
            var p = BuildPanel(parent, new Color(0.04f, 0.04f, 0.05f, 0.96f));
            AddTitle(p.transform, "OLD AMBER FACTORY", new Color(0.92f, 0.72f, 0.14f));
            AddText(p.transform, "You wake up at night in the abandoned 'Amber' factory. Something tall and thin is already hunting.\n" +
                                 "Find three truck keys, reach the yellow KAMAZ in the yard, and drive out alive.",
                    new Color(0.85f, 0.85f, 0.85f), 20, -80);

            string controls =
                "<b>WASD</b>  move         <b>Q</b>  sprint (loud)\n" +
                "<b>CTRL</b>  crouch (quiet) <b>Hold Shift</b>  binoculars (+ wheel = zoom 1×..8×)\n" +
                "<b>E</b>  interact / hide / security cams     <b>LMB</b> hold = aim, release = throw\n" +
                "<b>G</b>  drop held item";
            var ctrl = AddText(p.transform, controls, new Color(0.75f, 0.75f, 0.75f), 17, -20);
            ctrl.supportRichText = true;

            AddButton(p.transform, "ENTER THE DARK", () =>
            {
                HideAll();
                GameManager.I.StartGame();
            }, 80);
            return p;
        }

        private GameObject BuildDeathPanel(Transform parent)
        {
            var p = BuildPanel(parent, new Color(0.08f, 0.02f, 0.02f, 0.96f));
            AddTitle(p.transform, "YOU WERE TAKEN", new Color(0.75f, 0.1f, 0.1f));
            _deathText = AddText(p.transform, "", new Color(0.85f, 0.85f, 0.85f), 20, -80);
            _deathText.fontStyle = FontStyle.Italic;
            AddButton(p.transform, "TRY AGAIN", () =>
            {
                HideAll();
                GameManager.I.StartGame();
            }, 80);
            return p;
        }

        private GameObject BuildWinPanel(Transform parent)
        {
            var p = BuildPanel(parent, new Color(0.04f, 0.04f, 0.05f, 0.96f));
            AddTitle(p.transform, "ENGINE ROARS", new Color(0.92f, 0.72f, 0.14f));
            AddText(p.transform, "The headlights cut through the fog. You drive, and you do not look back.",
                    new Color(0.85f, 0.85f, 0.85f), 20, -80);
            AddButton(p.transform, "PLAY AGAIN", () =>
            {
                HideAll();
                GameManager.I.StartGame();
            }, 80);
            return p;
        }

        private GameObject BuildJumpscarePanel(Transform parent)
        {
            var go = new GameObject("Jumpscare");
            go.transform.SetParent(parent, false);
            var rt = go.AddComponent<RectTransform>();
            rt.anchorMin = Vector2.zero; rt.anchorMax = Vector2.one;
            rt.offsetMin = Vector2.zero; rt.offsetMax = Vector2.zero;
            go.AddComponent<Image>().color = Color.black;

            var face = new GameObject("Face");
            face.transform.SetParent(go.transform, false);
            var frt = face.AddComponent<RectTransform>();
            frt.anchorMin = new Vector2(0.5f, 0.5f); frt.anchorMax = new Vector2(0.5f, 0.5f);
            frt.sizeDelta = new Vector2(900, 900);
            frt.anchoredPosition = Vector2.zero;
            var img = face.AddComponent<RawImage>();
            img.texture = BuildJumpscareTexture(512);
            return go;
        }

        private Texture2D BuildJumpscareTexture(int size)
        {
            var t = new Texture2D(size, size, TextureFormat.RGBA32, false);
            var cs = new Color[size * size];
            Vector2 c = new Vector2(size * 0.5f, size * 0.5f);
            for (int y = 0; y < size; y++)
                for (int x = 0; x < size; x++)
                {
                    float dx = (x - c.x) / (size * 0.5f);
                    float dy = (y - c.y) / (size * 0.5f);
                    float d = Mathf.Sqrt(dx * dx + dy * dy);
                    float head = d < 0.8f ? 1f - d / 0.8f : 0f;
                    // Eyes
                    Vector2 eL = new Vector2(-0.22f, 0.12f);
                    Vector2 eR = new Vector2(0.22f, 0.12f);
                    float eye = Mathf.Max(
                        1f - new Vector2(dx - eL.x, dy - eL.y).magnitude / 0.09f,
                        1f - new Vector2(dx - eR.x, dy - eR.y).magnitude / 0.09f);
                    eye = Mathf.Clamp01(eye);
                    // Mouth (elongated)
                    float mouth = 1f - Mathf.Sqrt((dx * dx) * 4f + Mathf.Pow(dy + 0.25f, 2f) * 15f);
                    mouth = Mathf.Clamp01(mouth);

                    Color col = Color.black;
                    col = Color.Lerp(col, new Color(0.08f, 0.08f, 0.08f), head);
                    col = Color.Lerp(col, new Color(1f, 0.25f, 0.2f), Mathf.Pow(eye, 1.5f));
                    col = Color.Lerp(col, new Color(0.3f, 0f, 0f), mouth);
                    // Alpha = 0 outside head
                    float alpha = head > 0.01f ? 1f : 0f;
                    col.a = alpha;
                    cs[y * size + x] = col;
                }
            t.SetPixels(cs);
            t.Apply();
            return t;
        }

        private GameObject BuildPanel(Transform parent, Color bg)
        {
            var bgGo = new GameObject("Backdrop");
            bgGo.transform.SetParent(parent, false);
            var brt = bgGo.AddComponent<RectTransform>();
            brt.anchorMin = Vector2.zero; brt.anchorMax = Vector2.one;
            brt.offsetMin = Vector2.zero; brt.offsetMax = Vector2.zero;
            bgGo.AddComponent<Image>().color = bg;
            // Panel in center
            var pGo = new GameObject("Panel");
            pGo.transform.SetParent(bgGo.transform, false);
            var prt = pGo.AddComponent<RectTransform>();
            prt.anchorMin = new Vector2(0.5f, 0.5f); prt.anchorMax = new Vector2(0.5f, 0.5f);
            prt.sizeDelta = new Vector2(820, 520);
            prt.anchoredPosition = Vector2.zero;
            var im = pGo.AddComponent<Image>();
            im.color = new Color(0, 0, 0, 0.5f);
            return bgGo;
        }

        private void AddTitle(Transform parent, string t, Color col)
        {
            var go = new GameObject("Title");
            go.transform.SetParent(parent, false);
            var rt = go.AddComponent<RectTransform>();
            rt.anchorMin = new Vector2(0.5f, 0.5f); rt.anchorMax = new Vector2(0.5f, 0.5f);
            rt.pivot = new Vector2(0.5f, 0.5f);
            rt.sizeDelta = new Vector2(900, 80);
            rt.anchoredPosition = new Vector2(0, 160);
            var tx = go.AddComponent<Text>();
            tx.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            tx.fontSize = 46;
            tx.fontStyle = FontStyle.Bold;
            tx.alignment = TextAnchor.MiddleCenter;
            tx.text = t;
            tx.color = col;
        }

        private Text AddText(Transform parent, string s, Color col, int size, float yOff)
        {
            var go = new GameObject("Text");
            go.transform.SetParent(parent, false);
            var rt = go.AddComponent<RectTransform>();
            rt.anchorMin = new Vector2(0.5f, 0.5f); rt.anchorMax = new Vector2(0.5f, 0.5f);
            rt.pivot = new Vector2(0.5f, 0.5f);
            rt.sizeDelta = new Vector2(820, 160);
            rt.anchoredPosition = new Vector2(0, yOff);
            var tx = go.AddComponent<Text>();
            tx.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            tx.fontSize = size;
            tx.alignment = TextAnchor.MiddleCenter;
            tx.text = s;
            tx.color = col;
            tx.horizontalOverflow = HorizontalWrapMode.Wrap;
            return tx;
        }

        private void AddButton(Transform parent, string label, System.Action onClick, float yOff)
        {
            var go = new GameObject("Button");
            go.transform.SetParent(parent, false);
            var rt = go.AddComponent<RectTransform>();
            rt.anchorMin = new Vector2(0.5f, 0.5f); rt.anchorMax = new Vector2(0.5f, 0.5f);
            rt.pivot = new Vector2(0.5f, 0.5f);
            rt.sizeDelta = new Vector2(280, 64);
            rt.anchoredPosition = new Vector2(0, -yOff - 60);
            var im = go.AddComponent<Image>();
            im.color = new Color(0.1f, 0.1f, 0.12f, 1);
            var btn = go.AddComponent<Button>();
            btn.onClick.AddListener(() => onClick());

            var tgo = new GameObject("Text");
            tgo.transform.SetParent(go.transform, false);
            var trt = tgo.AddComponent<RectTransform>();
            trt.anchorMin = Vector2.zero; trt.anchorMax = Vector2.one;
            trt.offsetMin = Vector2.zero; trt.offsetMax = Vector2.zero;
            var tx = tgo.AddComponent<Text>();
            tx.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            tx.fontSize = 20;
            tx.alignment = TextAnchor.MiddleCenter;
            tx.text = label;
            tx.color = new Color(0.92f, 0.72f, 0.14f);
        }

        public void ShowStart() { _startPanel.SetActive(true); _deathPanel.SetActive(false); _winPanel.SetActive(false); _jumpscarePanel.SetActive(false); Cursor.lockState = CursorLockMode.None; Cursor.visible = true; }
        public void ShowDeath(string reason) { if (_deathText != null) _deathText.text = reason; _deathPanel.SetActive(true); _startPanel.SetActive(false); _winPanel.SetActive(false); Cursor.lockState = CursorLockMode.None; Cursor.visible = true; }
        public void ShowWin() { _winPanel.SetActive(true); Cursor.lockState = CursorLockMode.None; Cursor.visible = true; }
        public void ShowJumpscare(bool on) { _jumpscarePanel.SetActive(on); }
        public void HideAll() { _startPanel.SetActive(false); _deathPanel.SetActive(false); _winPanel.SetActive(false); _jumpscarePanel.SetActive(false); }
    }
}
