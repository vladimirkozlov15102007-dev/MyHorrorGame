using UnityEngine;

namespace AmberFactory
{
    /// <summary>
    /// A thrown object. Simple ballistic physics, collides with walls/ground,
    /// plays material-specific impact sound, emits a noise event to the AI.
    /// </summary>
    public class Projectile : MonoBehaviour
    {
        private ThrowableSystem _owner;
        private Throwable _src;
        private Vector3 _vel;
        private Vector3 _angVel;
        private bool _landed;
        private float _life = 8f;

        public void Init(ThrowableSystem owner, Throwable src, Vector3 velocity)
        {
            _owner = owner;
            _src = src;
            _vel = velocity;
            _angVel = new Vector3(Random.Range(-12f, 12f), Random.Range(-9f, 9f), Random.Range(-12f, 12f));
        }

        private void Update()
        {
            if (_landed)
            {
                _life -= Time.deltaTime;
                if (_life <= 0f) Destroy(gameObject);
                return;
            }

            _vel.y -= 18f * Time.deltaTime;

            // Substeps
            const int steps = 4;
            float sdt = Time.deltaTime / steps;
            for (int i = 0; i < steps; i++)
            {
                Vector3 next = transform.position + _vel * sdt;
                // Ground
                if (next.y <= 0.05f)
                {
                    next.y = 0.05f;
                    transform.position = next;
                    Land();
                    return;
                }
                // Wall/obstacle: raycast from old→new, layermask = default
                Vector3 diff = next - transform.position;
                float dist = diff.magnitude;
                if (dist > 0.001f)
                {
                    if (Physics.SphereCast(transform.position, 0.05f, diff.normalized, out var hit, dist, Physics.DefaultRaycastLayers, QueryTriggerInteraction.Ignore))
                    {
                        // Ignore hits on the player (the thrower themselves)
                        if (hit.collider.GetComponentInParent<PlayerController>() == null)
                        {
                            transform.position = hit.point - diff.normalized * 0.05f;
                            Land();
                            return;
                        }
                    }
                }
                transform.position = next;
            }
            transform.Rotate(_angVel * Time.deltaTime, Space.World);
        }

        private void Land()
        {
            _landed = true;
            _vel = Vector3.zero;

            // Material-specific SFX
            AudioClip clip;
            switch (_src.MaterialTag)
            {
                case "glass": clip = ProceduralAudio.Instance.GlassBreak; break;
                case "metal":
                case "metal-small": clip = ProceduralAudio.Instance.MetalClang; break;
                default: clip = ProceduralAudio.Instance.WoodThud; break;
            }
            ProceduralAudio.Instance.PlayOneShot3D(clip, transform.position, 1f, 1f, 1f, 45f);

            // Noise event for AI
            _owner.EmitNoise(transform.position, _src.Loudness);

            // If glass → shatter the projectile into debris and kill mesh quickly
            if (_src.MaterialTag == "glass")
            {
                SpawnShards();
                _life = 0.05f;
            }
            else
            {
                _life = 10f;
            }
        }

        private void SpawnShards()
        {
            var rend = GetComponent<Renderer>();
            var mat = rend != null ? rend.sharedMaterial : null;
            var go = new GameObject("Shards");
            go.transform.position = transform.position;
            var ps = go.AddComponent<ParticleSystem>();
            var main = ps.main;
            main.duration = 0.4f;
            main.startLifetime = 0.8f;
            main.startSpeed = 2.5f;
            main.startSize = 0.04f;
            main.startColor = new Color(0.3f, 0.7f, 0.4f, 0.9f);
            main.maxParticles = 60;
            var em = ps.emission;
            em.SetBursts(new ParticleSystem.Burst[] { new ParticleSystem.Burst(0f, 30) });
            em.rateOverTime = 0f;
            var shape = ps.shape;
            shape.shapeType = ParticleSystemShapeType.Sphere;
            shape.radius = 0.05f;
            var col = ps.colorOverLifetime;
            col.enabled = true;
            var grad = new Gradient();
            grad.SetKeys(new[] { new GradientColorKey(Color.white, 0), new GradientColorKey(Color.white, 1) },
                         new[] { new GradientAlphaKey(1, 0), new GradientAlphaKey(0, 1) });
            col.color = grad;
            var g = ps.forceOverLifetime;
            g.enabled = true;
            g.y = new ParticleSystem.MinMaxCurve(-6f);
            Destroy(go, 1.5f);
            if (GetComponent<MeshRenderer>()) GetComponent<MeshRenderer>().enabled = false;
        }
    }
}
