using UnityEngine;

namespace AmberFactory
{
    /// <summary>
    /// Fluorescent-tube flicker. When enabled, both the Light intensity and the tube's
    /// emission color wobble with perlin + rare full dropouts.
    /// </summary>
    public class FlickerLight : MonoBehaviour
    {
        public Light Light;
        public Renderer TubeRenderer;
        public Material TubeMaterial;
        public Color EmissionColor;
        public float BaseIntensity;
        public bool DoFlicker;

        private float _phase;

        private void Start()
        {
            _phase = Random.value * 10f;
            if (TubeRenderer != null && TubeMaterial != null)
            {
                // Clone so we can animate per-light
                var mat = new Material(TubeMaterial);
                TubeRenderer.sharedMaterial = mat;
                TubeMaterial = mat;
            }
        }

        private void Update()
        {
            if (Light == null) return;
            float t = Time.time + _phase;
            float n = Mathf.PerlinNoise(t * 1.5f, 0) - 0.5f;
            float dropout = 0f;
            if (DoFlicker && Random.value < 0.0035f) dropout = -0.7f;
            float intensity = Mathf.Max(0.15f, BaseIntensity + n * (DoFlicker ? 0.45f : 0.12f) + dropout);
            Light.intensity = intensity;

            if (TubeMaterial != null)
            {
                TubeMaterial.SetColor("_EmissionColor", EmissionColor * (0.3f + intensity * 0.4f));
            }
        }
    }
}
