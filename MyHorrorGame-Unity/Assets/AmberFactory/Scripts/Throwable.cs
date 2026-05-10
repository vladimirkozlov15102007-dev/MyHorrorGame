using UnityEngine;

namespace AmberFactory
{
    /// <summary>
    /// A pickupable/throwable object in the world: bottle, can, pipe, rebar, nut.
    /// When held by the player, its mesh is instantiated in camera space (see ThrowableSystem).
    /// When thrown, the projectile script handles physics + noise.
    /// </summary>
    public class Throwable : MonoBehaviour
    {
        public LevelBuilder.ThrowableType Type;
        public Vector3 SpawnPos;
        public bool Collected;

        public Material Material => BuildMaterial();
        public Mesh Mesh => BuildMesh();
        public Vector3 HoldScale => GetScale();
        public float Loudness => MaterialLoudness();
        public string MaterialTag => GetMaterialTag();

        private Material _cachedMat;
        private Mesh _cachedMesh;

        public void BuildVisual()
        {
            var visual = new GameObject("Visual");
            visual.transform.SetParent(transform, false);
            var mf = visual.AddComponent<MeshFilter>();
            var mr = visual.AddComponent<MeshRenderer>();
            mf.sharedMesh = BuildMesh();
            mr.sharedMaterial = BuildMaterial();
            visual.transform.localScale = GetScale();
            visual.transform.localRotation = Quaternion.Euler(Random.Range(-15f, 15f), Random.Range(0, 360f), Random.Range(-15f, 15f));
            visual.transform.localPosition = new Vector3(0, GetScale().y * 0.5f, 0);
        }

        public void Reset()
        {
            Collected = false;
            gameObject.SetActive(true);
            transform.position = SpawnPos;
        }

        public void Collect()
        {
            Collected = true;
            gameObject.SetActive(false);
        }

        // ----- shape + material -----

        private Vector3 GetScale()
        {
            switch (Type)
            {
                case LevelBuilder.ThrowableType.Bottle: return new Vector3(0.11f, 0.30f, 0.11f);
                case LevelBuilder.ThrowableType.Can:    return new Vector3(0.11f, 0.14f, 0.11f);
                case LevelBuilder.ThrowableType.Pipe:   return new Vector3(0.07f, 0.80f, 0.07f);
                case LevelBuilder.ThrowableType.Rebar:  return new Vector3(0.04f, 0.95f, 0.04f);
                case LevelBuilder.ThrowableType.Nut:    return new Vector3(0.10f, 0.05f, 0.10f);
            }
            return Vector3.one;
        }

        private Mesh BuildMesh()
        {
            if (_cachedMesh != null) return _cachedMesh;
            Mesh m;
            if (Type == LevelBuilder.ThrowableType.Nut)
            {
                // Use a simple cylinder, treat as a low nut
                var g = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
                m = g.GetComponent<MeshFilter>().sharedMesh;
                Destroy(g);
            }
            else
            {
                var g = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
                m = g.GetComponent<MeshFilter>().sharedMesh;
                Destroy(g);
            }
            _cachedMesh = m;
            return m;
        }

        private Material BuildMaterial()
        {
            if (_cachedMat != null) return _cachedMat;
            switch (Type)
            {
                case LevelBuilder.ThrowableType.Bottle:
                    _cachedMat = ProceduralTextures.Solid(new Color(0.18f, 0.38f, 0.22f), 0.85f, 0.15f,
                        emission: new Color(0.04f, 0.08f, 0.05f));
                    break;
                case LevelBuilder.ThrowableType.Can:
                    _cachedMat = ProceduralTextures.Solid(new Color(0.55f, 0.42f, 0.18f), 0.7f, 0.55f);
                    break;
                case LevelBuilder.ThrowableType.Pipe:
                    _cachedMat = ProceduralTextures.Solid(new Color(0.42f, 0.42f, 0.45f), 0.55f, 0.7f);
                    break;
                case LevelBuilder.ThrowableType.Rebar:
                    _cachedMat = ProceduralTextures.Solid(new Color(0.32f, 0.22f, 0.15f), 0.8f, 0.45f);
                    break;
                case LevelBuilder.ThrowableType.Nut:
                    _cachedMat = ProceduralTextures.Solid(new Color(0.28f, 0.28f, 0.30f), 0.55f, 0.8f);
                    break;
            }
            return _cachedMat;
        }

        private float MaterialLoudness()
        {
            return Type == LevelBuilder.ThrowableType.Bottle ? 1.0f :
                   Type == LevelBuilder.ThrowableType.Pipe ? 0.8f :
                   Type == LevelBuilder.ThrowableType.Rebar ? 0.75f :
                   Type == LevelBuilder.ThrowableType.Can ? 0.65f :
                   0.45f;
        }

        private string GetMaterialTag()
        {
            return Type == LevelBuilder.ThrowableType.Bottle ? "glass"
                 : Type == LevelBuilder.ThrowableType.Nut ? "metal-small"
                 : "metal";
        }

        private void Update()
        {
            if (Collected) return;
            // Gentle idle rotate
            transform.Rotate(0, 10f * Time.deltaTime, 0);
        }
    }
}
