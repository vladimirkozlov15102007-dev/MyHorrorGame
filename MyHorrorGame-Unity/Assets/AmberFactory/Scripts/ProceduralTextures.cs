using UnityEngine;

namespace AmberFactory
{
    /// <summary>
    /// Generates all textures and materials used by the factory. No import assets.
    /// Cached so repeated requests return the same object.
    /// </summary>
    public static class ProceduralTextures
    {
        private static Texture2D _concrete;
        private static Texture2D _rustMetal;
        private static Texture2D _stripedMetal;
        private static Texture2D _wood;
        private static Texture2D _dirt;
        private static Texture2D _asphalt;

        private static Material _concreteMat;
        private static Material _wallMat;
        private static Material _ceilMat;
        private static Material _rustMetalMat;
        private static Material _stripedMetalMat;
        private static Material _woodMat;
        private static Material _dirtMat;
        private static Material _asphaltMat;
        private static Material _glassMat;
        private static Material _windowMat;
        private static Material _yellowMat;
        private static Material _darkYellowMat;
        private static Material _tireMat;
        private static Material _monsterMat;
        private static Material _monsterLimbMat;
        private static Material _eyeMat;
        private static Material _paperMat;
        private static Material _fabricMat;

        // --- Public materials ---

        public static Material Floor()     { EnsureConcrete(); if (_concreteMat == null) _concreteMat = MakeLit(_concrete, new Vector2(4, 4), 0.9f, 0f); return _concreteMat; }
        public static Material Wall()      { EnsureConcrete(); if (_wallMat == null) _wallMat = MakeLit(_concrete, new Vector2(1, 1.5f), 0.85f, 0f, new Color(0.55f, 0.55f, 0.52f)); return _wallMat; }
        public static Material Ceiling()   { EnsureConcrete(); if (_ceilMat == null) _ceilMat = MakeLit(_concrete, new Vector2(4, 4), 1f, 0f, new Color(0.35f, 0.36f, 0.38f)); return _ceilMat; }
        public static Material RustMetal() { EnsureRust(); if (_rustMetalMat == null) _rustMetalMat = MakeLit(_rustMetal, Vector2.one, 0.65f, 0.55f); return _rustMetalMat; }
        public static Material StripedMetal() { EnsureStriped(); if (_stripedMetalMat == null) _stripedMetalMat = MakeLit(_stripedMetal, Vector2.one, 0.6f, 0.7f); return _stripedMetalMat; }
        public static Material Wood()      { EnsureWood(); if (_woodMat == null) _woodMat = MakeLit(_wood, Vector2.one, 0.9f, 0f); return _woodMat; }
        public static Material Dirt()      { EnsureDirt(); if (_dirtMat == null) _dirtMat = MakeLit(_dirt, new Vector2(8, 8), 1f, 0f); return _dirtMat; }
        public static Material Asphalt()   { EnsureAsphalt(); if (_asphaltMat == null) _asphaltMat = MakeLit(_asphalt, new Vector2(4, 4), 1f, 0f); return _asphaltMat; }

        public static Material Glass()
        {
            if (_glassMat == null)
            {
                _glassMat = new Material(Shader.Find("Standard"));
                _glassMat.color = new Color(0.05f, 0.08f, 0.12f, 1f);
                _glassMat.SetFloat("_Glossiness", 0.88f);
                _glassMat.SetFloat("_Metallic", 0.2f);
                _glassMat.SetColor("_EmissionColor", new Color(0.03f, 0.04f, 0.06f));
                _glassMat.EnableKeyword("_EMISSION");
            }
            return _glassMat;
        }

        public static Material Window()
        {
            if (_windowMat == null)
            {
                _windowMat = new Material(Shader.Find("Standard"));
                _windowMat.color = new Color(0.15f, 0.22f, 0.28f, 1f);
                _windowMat.SetFloat("_Glossiness", 0.6f);
                _windowMat.SetColor("_EmissionColor", new Color(0.12f, 0.18f, 0.26f));
                _windowMat.EnableKeyword("_EMISSION");
            }
            return _windowMat;
        }

        public static Material Yellow()
        {
            if (_yellowMat == null)
            {
                _yellowMat = new Material(Shader.Find("Standard"));
                _yellowMat.color = new Color(0.92f, 0.72f, 0.14f);
                _yellowMat.SetFloat("_Glossiness", 0.55f);
                _yellowMat.SetFloat("_Metallic", 0.25f);
            }
            return _yellowMat;
        }
        public static Material DarkYellow()
        {
            if (_darkYellowMat == null)
            {
                _darkYellowMat = new Material(Shader.Find("Standard"));
                _darkYellowMat.color = new Color(0.62f, 0.44f, 0.09f);
                _darkYellowMat.SetFloat("_Glossiness", 0.45f);
                _darkYellowMat.SetFloat("_Metallic", 0.3f);
            }
            return _darkYellowMat;
        }

        public static Material Tire()
        {
            if (_tireMat == null)
            {
                _tireMat = new Material(Shader.Find("Standard"));
                _tireMat.color = new Color(0.04f, 0.04f, 0.04f);
                _tireMat.SetFloat("_Glossiness", 0.1f);
            }
            return _tireMat;
        }

        public static Material MonsterBody()
        {
            if (_monsterMat == null)
            {
                _monsterMat = new Material(Shader.Find("Standard"));
                _monsterMat.color = new Color(0.03f, 0.03f, 0.035f);
                _monsterMat.SetFloat("_Glossiness", 0.3f);
                _monsterMat.SetColor("_EmissionColor", new Color(0.01f, 0.01f, 0.015f));
                _monsterMat.EnableKeyword("_EMISSION");
            }
            return _monsterMat;
        }
        public static Material MonsterLimb()
        {
            if (_monsterLimbMat == null)
            {
                _monsterLimbMat = new Material(Shader.Find("Standard"));
                _monsterLimbMat.color = new Color(0.02f, 0.02f, 0.025f);
                _monsterLimbMat.SetFloat("_Glossiness", 0.25f);
            }
            return _monsterLimbMat;
        }

        public static Material Eye()
        {
            if (_eyeMat == null)
            {
                _eyeMat = new Material(Shader.Find("Standard"));
                _eyeMat.color = new Color(1f, 0.15f, 0.15f);
                _eyeMat.SetColor("_EmissionColor", new Color(2f, 0.2f, 0.2f));
                _eyeMat.EnableKeyword("_EMISSION");
                _eyeMat.globalIlluminationFlags = MaterialGlobalIlluminationFlags.EmissiveIsBlack;
            }
            return _eyeMat;
        }

        public static Material Paper()
        {
            if (_paperMat == null)
            {
                _paperMat = new Material(Shader.Find("Standard"));
                _paperMat.color = new Color(0.78f, 0.73f, 0.56f);
                _paperMat.SetFloat("_Glossiness", 0.05f);
            }
            return _paperMat;
        }

        public static Material Fabric()
        {
            if (_fabricMat == null)
            {
                _fabricMat = new Material(Shader.Find("Standard"));
                _fabricMat.color = new Color(0.30f, 0.22f, 0.16f);
                _fabricMat.SetFloat("_Glossiness", 0.05f);
            }
            return _fabricMat;
        }

        public static Material Solid(Color c, float gloss = 0.3f, float metallic = 0f, Color? emission = null)
        {
            var m = new Material(Shader.Find("Standard"));
            m.color = c;
            m.SetFloat("_Glossiness", gloss);
            m.SetFloat("_Metallic", metallic);
            if (emission.HasValue)
            {
                m.SetColor("_EmissionColor", emission.Value);
                m.EnableKeyword("_EMISSION");
            }
            return m;
        }

        // --- Helpers ---

        private static Material MakeLit(Texture2D tex, Vector2 tile, float rough, float metal, Color? tint = null)
        {
            var m = new Material(Shader.Find("Standard"));
            m.mainTexture = tex;
            m.mainTextureScale = tile;
            m.color = tint ?? Color.white;
            m.SetFloat("_Glossiness", Mathf.Clamp01(1f - rough));
            m.SetFloat("_Metallic", metal);
            return m;
        }

        // --- Texture generators ---

        private static void EnsureConcrete()
        {
            if (_concrete != null) return;
            _concrete = MakeNoiseTex(256, (u, v, rng) =>
            {
                float n = Perlin01(u * 4f, v * 4f) * 0.35f + Perlin01(u * 12f, v * 12f) * 0.25f;
                float spots = rng < 0.03f ? 0.15f : 0f;
                float streak = 0f;
                if ((int)(v * 256) % 37 == 0) streak = 0.05f;
                float g = 0.36f + n * 0.18f - spots - streak;
                return new Color(g, g * 1.02f, g * 0.98f);
            });
        }

        private static void EnsureRust()
        {
            if (_rustMetal != null) return;
            _rustMetal = MakeNoiseTex(256, (u, v, rng) =>
            {
                float baseG = 0.22f;
                float n = Perlin01(u * 8f, v * 8f);
                float rust = Mathf.Clamp01(Perlin01(u * 3f, v * 3f) - 0.45f) * 2f;
                Color metal = new Color(baseG + n * 0.15f, baseG + n * 0.12f, baseG + n * 0.10f);
                Color orange = new Color(0.38f + rust * 0.2f, 0.18f + rust * 0.1f, 0.05f);
                return Color.Lerp(metal, orange, rust);
            });
        }

        private static void EnsureStriped()
        {
            if (_stripedMetal != null) return;
            _stripedMetal = MakeNoiseTex(128, (u, v, rng) =>
            {
                float stripe = (Mathf.FloorToInt(v * 8) % 2 == 0) ? 0f : 0.06f;
                float n = Perlin01(u * 16f, v * 16f);
                float g = 0.32f + stripe + n * 0.05f;
                return new Color(g * 1.05f, g, g * 0.88f);
            });
        }

        private static void EnsureWood()
        {
            if (_wood != null) return;
            _wood = MakeNoiseTex(256, (u, v, rng) =>
            {
                float grain = Mathf.Sin(v * 50f + Perlin01(u * 4f, v * 4f) * 6f) * 0.06f;
                float n = Perlin01(u * 10f, v * 40f) * 0.15f;
                float r = 0.32f + grain + n;
                float g = 0.20f + grain * 0.8f + n * 0.7f;
                float b = 0.10f + grain * 0.5f + n * 0.5f;
                return new Color(r, g, b);
            });
        }

        private static void EnsureDirt()
        {
            if (_dirt != null) return;
            _dirt = MakeNoiseTex(256, (u, v, rng) =>
            {
                float n = Perlin01(u * 6f, v * 6f) * 0.25f + Perlin01(u * 20f, v * 20f) * 0.15f;
                float r = 0.18f + n;
                float g = 0.22f + n * 0.95f;
                float b = 0.14f + n * 0.8f;
                return new Color(r, g, b);
            });
        }

        private static void EnsureAsphalt()
        {
            if (_asphalt != null) return;
            _asphalt = MakeNoiseTex(256, (u, v, rng) =>
            {
                float n = Perlin01(u * 18f, v * 18f) * 0.25f + (rng < 0.08f ? 0.1f : 0f);
                float g = 0.15f + n * 0.15f;
                return new Color(g, g, g * 1.05f);
            });
        }

        private delegate Color PixelFunc(float u, float v, float rng);

        private static Texture2D MakeNoiseTex(int size, PixelFunc fn)
        {
            var tex = new Texture2D(size, size, TextureFormat.RGB24, true, false);
            tex.wrapMode = TextureWrapMode.Repeat;
            tex.filterMode = FilterMode.Trilinear;
            tex.anisoLevel = 4;
            var cs = new Color[size * size];
            for (int y = 0; y < size; y++)
                for (int x = 0; x < size; x++)
                {
                    float u = x / (float)size, v = y / (float)size;
                    float rng = (float)System.Math.Abs(((x * 374761393) ^ (y * 668265263)) & 0xFFFF) / 65535f;
                    cs[y * size + x] = fn(u, v, rng);
                }
            tex.SetPixels(cs);
            tex.Apply(true);
            return tex;
        }

        private static float Perlin01(float x, float y) { return Mathf.PerlinNoise(x, y); }
    }
}
