using UnityEngine;

namespace AmberFactory
{
    /// <summary>
    /// Simple pickup (currently used for truck keys). Rotates + bobs + has a subtle glow light.
    /// </summary>
    public class Pickup : MonoBehaviour
    {
        public enum Kind { Key }
        public Kind Type;
        public Vector3 SpawnPos;
        public bool Collected;
        public string Label = "TRUCK KEY";

        private Light _halo;
        private float _phase;

        public void BuildVisual()
        {
            if (Type == Kind.Key)
            {
                var goldMat = ProceduralTextures.Solid(new Color(0.85f, 0.72f, 0.2f), 0.3f, 0.8f,
                    emission: new Color(0.5f, 0.4f, 0.1f));
                // shaft
                var shaft = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
                shaft.transform.SetParent(transform, false);
                shaft.transform.localPosition = Vector3.zero;
                shaft.transform.localScale = new Vector3(0.04f, 0.11f, 0.04f);
                shaft.transform.localRotation = Quaternion.Euler(0, 0, 90);
                shaft.GetComponent<Renderer>().sharedMaterial = goldMat;
                Destroy(shaft.GetComponent<Collider>());
                // head ring (torus approximated by thin cylinder + scaled sphere)
                var head = GameObject.CreatePrimitive(PrimitiveType.Sphere);
                head.transform.SetParent(transform, false);
                head.transform.localPosition = new Vector3(-0.12f, 0, 0);
                head.transform.localScale = new Vector3(0.12f, 0.12f, 0.03f);
                head.GetComponent<Renderer>().sharedMaterial = goldMat;
                Destroy(head.GetComponent<Collider>());
                // tooth
                var tooth = GameObject.CreatePrimitive(PrimitiveType.Cube);
                tooth.transform.SetParent(transform, false);
                tooth.transform.localPosition = new Vector3(0.10f, -0.03f, 0);
                tooth.transform.localScale = new Vector3(0.04f, 0.04f, 0.02f);
                tooth.GetComponent<Renderer>().sharedMaterial = goldMat;
                Destroy(tooth.GetComponent<Collider>());
            }

            var lgo = new GameObject("Halo");
            lgo.transform.SetParent(transform, false);
            _halo = lgo.AddComponent<Light>();
            _halo.type = LightType.Point;
            _halo.color = new Color(1f, 0.85f, 0.35f);
            _halo.intensity = 0.7f;
            _halo.range = 2.2f;

            _phase = Random.value * 10f;
        }

        public void Reset()
        {
            Collected = false;
            gameObject.SetActive(true);
            transform.position = SpawnPos;
        }

        private void Update()
        {
            if (Collected) return;
            transform.Rotate(0, 60f * Time.deltaTime, 0);
            float t = Time.time + _phase;
            transform.position = SpawnPos + new Vector3(0, Mathf.Sin(t * 2f) * 0.06f, 0);
        }

        public void Collect()
        {
            if (Collected) return;
            Collected = true;
            gameObject.SetActive(false);
        }
    }
}
