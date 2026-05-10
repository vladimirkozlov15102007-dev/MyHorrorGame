using UnityEngine;

namespace AmberFactory
{
    /// <summary>
    /// Randomized ambient oneshots: distant drips, creaking metal, wind gusts, and
    /// player-relative 3D heart/breath layers driven by tension.
    /// </summary>
    public class AmbientSfx : MonoBehaviour
    {
        private float _dripT = 3f;
        private float _creakT = 5f;
        private float _windT = 10f;
        private float _heartT = 1f;
        private float _breathT = 2f;
        private AudioSource _heartSrc;
        private AudioSource _breathSrc;

        private void Start()
        {
            ProceduralAudio.EnsureExists();

            var hGo = new GameObject("HeartLoop");
            hGo.transform.SetParent(transform, false);
            _heartSrc = hGo.AddComponent<AudioSource>();
            _heartSrc.clip = ProceduralAudio.Instance.HeartBeat;
            _heartSrc.volume = 0;
            _heartSrc.spatialBlend = 0f;
            _heartSrc.loop = false;
            _heartSrc.playOnAwake = false;

            var bGo = new GameObject("BreathLoop");
            bGo.transform.SetParent(transform, false);
            _breathSrc = bGo.AddComponent<AudioSource>();
            _breathSrc.clip = ProceduralAudio.Instance.Breath;
            _breathSrc.volume = 0;
            _breathSrc.spatialBlend = 0f;
            _breathSrc.loop = false;
            _breathSrc.playOnAwake = false;
        }

        private void Update()
        {
            if (GameManager.I == null || GameManager.I.Player == null) return;
            var p = GameManager.I.Player.transform.position;
            var m = GameManager.I.Monster != null ? GameManager.I.Monster.transform.position : p;
            float dist = Vector3.Distance(p, m);
            bool chasing = GameManager.I.Monster != null && GameManager.I.Monster.IsChasing;
            bool binoc = GameManager.I.Player.Binoculars;
            bool sprint = GameManager.I.Player.Sprinting;
            bool hidden = GameManager.I.Player.Hidden;

            float tension = 0f;
            if (dist < 20f) tension = 0.55f + (1f - Mathf.Min(1f, dist / 20f)) * 0.45f;
            else if (dist < 40f) tension = (40f - dist) / 40f;

            // Drips / creaks / wind
            _dripT -= Time.deltaTime;
            if (_dripT <= 0f)
            {
                _dripT = Random.Range(5f, 15f);
                float a = Random.Range(0, Mathf.PI * 2);
                float d = Random.Range(5f, 14f);
                ProceduralAudio.Instance.PlayOneShot3D(ProceduralAudio.Instance.Drip,
                    p + new Vector3(Mathf.Cos(a) * d, 2.5f, Mathf.Sin(a) * d), 0.6f, 1f, 1f, 30f);
            }

            _creakT -= Time.deltaTime;
            if (_creakT <= 0f)
            {
                _creakT = Random.Range(8f, 16f);
                float a = Random.Range(0, Mathf.PI * 2);
                float d = Random.Range(6f, 18f);
                ProceduralAudio.Instance.PlayOneShot3D(ProceduralAudio.Instance.Creak,
                    p + new Vector3(Mathf.Cos(a) * d, 3f, Mathf.Sin(a) * d), 0.5f, 1f, 1f, 30f);
            }

            _windT -= Time.deltaTime;
            if (_windT <= 0f)
            {
                _windT = Random.Range(14f, 24f);
                // Gust: short ambient wind clip
                ProceduralAudio.Instance.PlayOneShot2D(ProceduralAudio.Instance.AmbientWind, 0.25f);
            }

            // Heart
            float heartVol = tension * 0.55f + (chasing ? 0.25f : 0f);
            float heartRate = 0.9f + tension * 1.6f + (chasing ? 0.8f : 0f);
            _heartSrc.volume = Mathf.Lerp(_heartSrc.volume, heartVol * 0.6f, Time.deltaTime * 4f);
            _heartT -= Time.deltaTime;
            if (_heartT <= 0 && heartVol > 0.1f)
            {
                _heartT = 1f / heartRate;
                _heartSrc.Stop();
                _heartSrc.Play();
            }

            // Breath
            float bv = sprint ? 0.35f : hidden ? 0.12f : 0.06f;
            if (binoc) bv *= 0.5f;
            _breathSrc.volume = Mathf.Lerp(_breathSrc.volume, bv * 0.8f, Time.deltaTime * 3f);
            _breathT -= Time.deltaTime;
            float bi = sprint ? 0.9f : hidden ? 3.2f : 2.6f;
            if (_breathT <= 0f)
            {
                _breathT = bi;
                _breathSrc.Stop();
                _breathSrc.Play();
            }

            // Occasional distant monster breath at mid range
            if (dist > 10f && dist < 30f && Random.value < Time.deltaTime * 0.12f)
                ProceduralAudio.Instance.PlayOneShot3D(ProceduralAudio.Instance.MonsterBreath, m, 0.5f);
        }
    }
}
