using UnityEngine;

namespace AmberFactory
{
    /// <summary>
    /// Layered adaptive music. 4 AudioSources loop continuously; target volumes are
    /// derived from monster distance and chase state, then crossfaded.
    ///
    ///   - Ambient   : always playing, ducks when tension rises.
    ///   - Tension1  : fades in around 25–40m.
    ///   - Tension2  : fades in under ~20m.
    ///   - Chase     : fades in only during monster Chase state, carries the drums.
    /// </summary>
    public class DynamicMusic : MonoBehaviour
    {
        private AudioSource _amb, _t1, _t2, _chase;
        private float _tension;  // smoothed
        private float _chasing;  // smoothed

        private void Start()
        {
            ProceduralAudio.EnsureExists();
            _amb = MakeLoop("Music.Ambient", ProceduralAudio.Instance.AmbientDrone, 0.55f);
            _t1 = MakeLoop("Music.T1", ProceduralAudio.Instance.MusicTension1, 0f);
            _t2 = MakeLoop("Music.T2", ProceduralAudio.Instance.MusicTension2, 0f);
            _chase = MakeLoop("Music.Chase", ProceduralAudio.Instance.MusicChase, 0f);
        }

        private AudioSource MakeLoop(string n, AudioClip clip, float v)
        {
            var go = new GameObject(n);
            go.transform.SetParent(transform, false);
            var s = go.AddComponent<AudioSource>();
            s.clip = clip;
            s.loop = true;
            s.volume = v;
            s.spatialBlend = 0f;
            s.playOnAwake = false;
            s.priority = 0;
            s.Play();
            return s;
        }

        private void Update()
        {
            if (GameManager.I == null || GameManager.I.Player == null || GameManager.I.Monster == null) return;

            float dist = Vector3.Distance(GameManager.I.Player.transform.position, GameManager.I.Monster.transform.position);
            bool chasing = GameManager.I.Monster.IsChasing;

            // Target tension 0..1
            float t;
            if (dist < 20f) t = 0.55f + (1f - Mathf.Min(1f, dist / 20f)) * 0.45f;
            else if (dist < 40f) t = (40f - dist) / 40f;
            else t = 0f;

            _tension = Mathf.Lerp(_tension, t, Time.deltaTime * 1.3f);
            _chasing = Mathf.Lerp(_chasing, chasing ? 1f : 0f, Time.deltaTime * 2f);

            // Volumes
            float ambV = Mathf.Clamp01(0.55f - _tension * 0.25f);
            float t1V = Mathf.Clamp01((_tension - 0.05f) * 1.4f) * 0.55f * (1f - _chasing * 0.5f);
            float t2V = Mathf.Clamp01((_tension - 0.55f) * 2.2f) * 0.7f * (1f - _chasing * 0.4f);
            float chV = _chasing * 0.6f;

            _amb.volume = Mathf.Lerp(_amb.volume, ambV, Time.deltaTime * 3f);
            _t1.volume = Mathf.Lerp(_t1.volume, t1V, Time.deltaTime * 3f);
            _t2.volume = Mathf.Lerp(_t2.volume, t2V, Time.deltaTime * 3f);
            _chase.volume = Mathf.Lerp(_chase.volume, chV, Time.deltaTime * 4f);
        }
    }
}
