using UnityEngine;

namespace AmberFactory
{
    /// <summary> Procedurally-built tall thin monster with walk animation. </summary>
    public class MonsterMesh : MonoBehaviour
    {
        private Transform _torso, _head, _neck, _armL, _armR, _legL, _legR;
        private float _phase;

        public void Build()
        {
            var body = ProceduralTextures.MonsterBody();
            var limb = ProceduralTextures.MonsterLimb();
            var eye = ProceduralTextures.Eye();

            _torso = AddPrim(PrimitiveType.Cylinder, new Vector3(0.32f, 0.55f, 0.22f), body, new Vector3(0, 1.55f, 0));
            _neck  = AddPrim(PrimitiveType.Cylinder, new Vector3(0.12f, 0.15f, 0.12f), body, new Vector3(0, 2.05f, 0));
            _head  = AddPrim(PrimitiveType.Sphere,   new Vector3(0.36f, 0.55f, 0.42f), body, new Vector3(0, 2.3f, 0));

            AddPrim(PrimitiveType.Sphere, new Vector3(0.07f, 0.07f, 0.07f), eye, new Vector3(-0.08f, 2.33f, 0.18f));
            AddPrim(PrimitiveType.Sphere, new Vector3(0.07f, 0.07f, 0.07f), eye, new Vector3(0.08f, 2.33f, 0.18f));
            // Add point light for eye glow
            var el = new GameObject("EyeGlow");
            el.transform.SetParent(transform, false);
            el.transform.localPosition = new Vector3(0, 2.33f, 0.2f);
            var pl = el.AddComponent<Light>();
            pl.type = LightType.Point;
            pl.color = new Color(1f, 0.2f, 0.2f);
            pl.intensity = 0.9f;
            pl.range = 2.2f;

            _armL = AddPrim(PrimitiveType.Cylinder, new Vector3(0.10f, 0.8f, 0.10f), limb, new Vector3(-0.22f, 1.25f, 0));
            _armL.localRotation = Quaternion.Euler(0, 0, 10);
            _armR = AddPrim(PrimitiveType.Cylinder, new Vector3(0.10f, 0.8f, 0.10f), limb, new Vector3(0.22f, 1.25f, 0));
            _armR.localRotation = Quaternion.Euler(0, 0, -10);

            _legL = AddPrim(PrimitiveType.Cylinder, new Vector3(0.14f, 0.65f, 0.14f), limb, new Vector3(-0.1f, 0.65f, 0));
            _legR = AddPrim(PrimitiveType.Cylinder, new Vector3(0.14f, 0.65f, 0.14f), limb, new Vector3(0.1f, 0.65f, 0));

            // Red proximity aura
            var auraGO = new GameObject("Aura");
            auraGO.transform.SetParent(transform, false);
            auraGO.transform.localPosition = Vector3.up * 1.2f;
            var al = auraGO.AddComponent<Light>();
            al.type = LightType.Point;
            al.color = new Color(0.35f, 0.02f, 0.02f);
            al.intensity = 0.6f;
            al.range = 3.5f;
        }

        private Transform AddPrim(PrimitiveType t, Vector3 scale, Material mat, Vector3 localPos)
        {
            var g = GameObject.CreatePrimitive(t);
            g.transform.SetParent(transform, false);
            g.transform.localScale = scale;
            g.transform.localPosition = localPos;
            g.GetComponent<Renderer>().sharedMaterial = mat;
            Destroy(g.GetComponent<Collider>());
            return g.transform;
        }

        public void Animate(float dt, float speedLen)
        {
            if (speedLen > 0.01f) _phase += dt * speedLen * 2f;
            float s = Mathf.Sin(_phase);
            float c = Mathf.Cos(_phase);
            if (_legL) _legL.localRotation = Quaternion.Euler(s * 40f, 0, 0);
            if (_legR) _legR.localRotation = Quaternion.Euler(-s * 40f, 0, 0);
            if (_armL) _armL.localRotation = Quaternion.Euler(-s * 28f + 12f, 0, 10f);
            if (_armR) _armR.localRotation = Quaternion.Euler(s * 28f + 12f, 0, -10f);
            if (_head) _head.localPosition = new Vector3(0, 2.3f + Mathf.Abs(c) * 0.03f, 0);
        }
    }
}
