using System.Collections.Generic;
using UnityEngine;

namespace AmberFactory
{
    /// <summary>
    /// Generates AudioClips procedurally — drones, footsteps, impacts, growls.
    /// All synthesized on first access and cached. No audio file imports required.
    /// Also owns a pool of one-shot AudioSources so spatial oneshots are cheap.
    /// </summary>
    public class ProceduralAudio : MonoBehaviour
    {
        public static ProceduralAudio Instance { get; private set; }

        private const int SR = 44100;

        // Looping clips
        public AudioClip AmbientDrone { get; private set; }
        public AudioClip AmbientWind { get; private set; }
        public AudioClip MusicTension1 { get; private set; }
        public AudioClip MusicTension2 { get; private set; }
        public AudioClip MusicChase { get; private set; }

        // Oneshots
        public AudioClip PlayerStep { get; private set; }
        public AudioClip PlayerStepSoft { get; private set; }
        public AudioClip MonsterStep { get; private set; }
        public AudioClip MonsterGrowl { get; private set; }
        public AudioClip MonsterBreath { get; private set; }
        public AudioClip MonsterScreech { get; private set; }
        public AudioClip Stinger { get; private set; }
        public AudioClip HeartBeat { get; private set; }
        public AudioClip Breath { get; private set; }
        public AudioClip GlassBreak { get; private set; }
        public AudioClip MetalClang { get; private set; }
        public AudioClip WoodThud { get; private set; }
        public AudioClip Pickup { get; private set; }
        public AudioClip KeyPickup { get; private set; }
        public AudioClip Whoosh { get; private set; }
        public AudioClip DoorOpen { get; private set; }
        public AudioClip LockerOpen { get; private set; }
        public AudioClip EngineCrank { get; private set; }
        public AudioClip EngineStart { get; private set; }
        public AudioClip CCTVBoot { get; private set; }
        public AudioClip CCTVShutdown { get; private set; }
        public AudioClip CCTVStatic { get; private set; }
        public AudioClip Drip { get; private set; }
        public AudioClip Creak { get; private set; }
        public AudioClip LightBuzz { get; private set; }

        // One-shot pool
        private readonly Queue<AudioSource> _pool = new Queue<AudioSource>();
        private const int POOL_SIZE = 16;

        public static ProceduralAudio EnsureExists()
        {
            if (Instance != null) return Instance;
            var go = new GameObject("[ProceduralAudio]");
            DontDestroyOnLoad(go);
            return go.AddComponent<ProceduralAudio>();
        }

        private void Awake()
        {
            Instance = this;
            GenerateAll();
            for (int i = 0; i < POOL_SIZE; i++)
            {
                var go = new GameObject($"OneShot_{i}");
                go.transform.SetParent(transform, false);
                var src = go.AddComponent<AudioSource>();
                src.playOnAwake = false;
                src.spatialBlend = 1f;
                src.rolloffMode = AudioRolloffMode.Linear;
                src.minDistance = 1f;
                src.maxDistance = 40f;
                _pool.Enqueue(src);
            }
        }

        private void GenerateAll()
        {
            AmbientDrone = BuildAmbientDrone();
            AmbientWind = BuildAmbientWind();
            MusicTension1 = BuildTension1();
            MusicTension2 = BuildTension2();
            MusicChase = BuildChaseLayer();

            PlayerStep = BuildFootstep(intensity: 0.35f, seed: 1);
            PlayerStepSoft = BuildFootstep(intensity: 0.15f, seed: 2);
            MonsterStep = BuildMonsterFootstep();
            MonsterGrowl = BuildGrowl();
            MonsterBreath = BuildMonsterBreath();
            MonsterScreech = BuildScreech();
            Stinger = BuildStinger();
            HeartBeat = BuildHeartbeat();
            Breath = BuildBreath();
            GlassBreak = BuildGlassBreak();
            MetalClang = BuildMetalClang();
            WoodThud = BuildWoodThud();
            Pickup = BuildPickup(1200, 1800);
            KeyPickup = BuildPickup(1500, 2200);
            Whoosh = BuildWhoosh();
            DoorOpen = BuildDoorOpen();
            LockerOpen = BuildLockerOpen();
            EngineCrank = BuildEngineCrank();
            EngineStart = BuildEngineStart();
            CCTVBoot = BuildCCTVBoot();
            CCTVShutdown = BuildCCTVShutdown();
            CCTVStatic = BuildCCTVStatic();
            Drip = BuildDrip();
            Creak = BuildCreak();
            LightBuzz = BuildLightBuzz();
        }

        // ---------- Play helpers ----------

        public AudioSource PlayOneShot3D(AudioClip clip, Vector3 pos, float volume = 1f, float pitch = 1f,
                                         float minDist = 1f, float maxDist = 40f)
        {
            if (clip == null || _pool.Count == 0) return null;
            var src = _pool.Dequeue();
            src.transform.position = pos;
            src.clip = clip;
            src.volume = volume;
            src.pitch = pitch;
            src.spatialBlend = 1f;
            src.minDistance = minDist;
            src.maxDistance = maxDist;
            src.Play();
            StartCoroutine(ReturnToPool(src, clip.length / Mathf.Max(0.05f, pitch) + 0.1f));
            return src;
        }

        public void PlayOneShot2D(AudioClip clip, float volume = 1f)
        {
            if (clip == null || _pool.Count == 0) return;
            var src = _pool.Dequeue();
            src.transform.position = Vector3.zero;
            src.clip = clip;
            src.volume = volume;
            src.pitch = 1f;
            src.spatialBlend = 0f;
            src.Play();
            StartCoroutine(ReturnToPool(src, clip.length + 0.1f));
        }

        public void PlayScreech(Vector3 pos) => PlayOneShot3D(MonsterScreech, pos, 1.0f, 1f, 5f, 60f);
        public void PlayStinger() => PlayOneShot2D(Stinger, 0.9f);

        private System.Collections.IEnumerator ReturnToPool(AudioSource src, float delay)
        {
            yield return new WaitForSeconds(delay);
            src.Stop();
            src.spatialBlend = 1f;
            _pool.Enqueue(src);
        }

        // ---------- Synth helpers ----------

        private static float Rand() { return UnityEngine.Random.value * 2f - 1f; }

        private static AudioClip CreateClip(string name, float seconds, System.Func<float, float, float> gen)
        {
            int len = Mathf.CeilToInt(seconds * SR);
            var data = new float[len];
            for (int i = 0; i < len; i++)
            {
                float t = i / (float)SR;
                data[i] = gen(t, i / (float)len);
            }
            var clip = AudioClip.Create(name, len, 1, SR, false);
            clip.SetData(data, 0);
            return clip;
        }

        private static float Env(float x, float attack = 0.01f, float release = 0.1f)
        {
            if (x < attack) return x / attack;
            return Mathf.Max(0f, 1f - (x - attack) / release);
        }

        // ---------- Looping clips ----------

        private AudioClip BuildAmbientDrone()
        {
            return CreateClip("AmbientDrone", 6.0f, (t, u) =>
            {
                float s = 0.14f * Mathf.Sin(2f * Mathf.PI * 41f * t) * LowPassPhase(t, 0.9f);
                s += 0.10f * Mathf.Sin(2f * Mathf.PI * 55f * t + Mathf.Sin(t * 0.3f) * 0.2f);
                s += 0.08f * SawOsc(62f, t);
                // breathing LFO
                float lfo = 0.8f + 0.2f * Mathf.Sin(2f * Mathf.PI * 0.08f * t);
                return s * lfo * 0.6f;
            });
        }

        private AudioClip BuildAmbientWind()
        {
            return CreateClip("AmbientWind", 5.0f, (t, u) =>
            {
                float noise = Rand();
                // bandpass-ish wobble
                float modFreq = 0.13f;
                float modulated = Mathf.Sin(2f * Mathf.PI * (300f + 220f * Mathf.Sin(2f * Mathf.PI * modFreq * t)) * t);
                return 0.18f * noise * 0.5f + 0.08f * modulated * 0.1f;
            });
        }

        private AudioClip BuildTension1()
        {
            return CreateClip("Tension1", 8.0f, (t, u) =>
            {
                // Sub pulse at 0.85 Hz, dark minor cluster pad
                float pulse = 0.5f + 0.5f * Mathf.Sin(2f * Mathf.PI * 0.85f * t);
                float sub = 0.22f * Mathf.Sin(2f * Mathf.PI * 46f * t) * pulse;
                float pad = 0f;
                foreach (float f in new float[] { 98f, 103.83f, 146.83f })
                    pad += SawOsc(f, t) * 0.06f;
                pad *= LowPassPhase(t, 0.95f);
                return (sub + pad) * 0.65f;
            });
        }

        private AudioClip BuildTension2()
        {
            return CreateClip("Tension2", 8.0f, (t, u) =>
            {
                float bass = 0f;
                foreach (float f in new float[] { 55f, 58.27f, 73.42f })
                    bass += SawOsc(f, t) * 0.08f;
                bass *= LowPassPhase(t, 0.98f);
                float strTrem = 0.6f + 0.4f * Mathf.Sin(2f * Mathf.PI * 5.5f * t);
                float str = (SawOsc(880f, t) + SawOsc(932.33f, t)) * 0.05f * strTrem;
                return (bass + str) * 0.6f;
            });
        }

        private AudioClip BuildChaseLayer()
        {
            return CreateClip("Chase", 2.0f, (t, u) =>
            {
                // Short drum-loop layer: a kick every 0.4s + high tick
                float mod = t % 0.4f;
                float kick = 0f;
                if (mod < 0.2f)
                {
                    float freq = Mathf.Lerp(110f, 38f, mod / 0.2f);
                    kick = 0.55f * Mathf.Sin(2f * Mathf.PI * freq * mod) * Mathf.Exp(-mod * 18f);
                }
                float tick = (mod < 0.02f) ? 0.12f * Rand() : 0f;
                float pad = 0.06f * SawOsc(110f, t) + 0.04f * SawOsc(146.8f, t);
                return kick + tick + pad * LowPassPhase(t, 0.9f);
            });
        }

        // ---------- Oneshots ----------

        private AudioClip BuildFootstep(float intensity, int seed)
        {
            UnityEngine.Random.InitState(100 + seed);
            return CreateClip($"step{seed}", 0.15f, (t, u) =>
            {
                float e = Mathf.Exp(-t * 28f);
                float low = 0.6f * Mathf.Sin(2f * Mathf.PI * (180f - 40f * u) * t);
                float noise = 0.25f * Rand();
                return intensity * (low + noise) * e;
            });
        }

        private AudioClip BuildMonsterFootstep()
        {
            return CreateClip("mstep", 0.3f, (t, u) =>
            {
                float e = Mathf.Exp(-t * 8f);
                float low = 0.7f * Mathf.Sin(2f * Mathf.PI * 75f * t);
                float sub = 0.4f * Mathf.Sin(2f * Mathf.PI * 38f * t);
                float noise = 0.18f * Rand() * e;
                return (low + sub + noise) * e * 0.55f;
            });
        }

        private AudioClip BuildGrowl()
        {
            return CreateClip("growl", 1.3f, (t, u) =>
            {
                float f = Mathf.Lerp(80f, 45f, u);
                float vib = Mathf.Sin(2f * Mathf.PI * 18f * t) * 12f;
                float s = SawOsc(f + vib, t);
                float e = Mathf.Sin(Mathf.PI * u);
                float noise = 0.15f * Rand();
                return (s + noise) * e * 0.55f;
            });
        }

        private AudioClip BuildMonsterBreath()
        {
            return CreateClip("mbreath", 1.4f, (t, u) =>
            {
                float e = Mathf.Sin(Mathf.PI * u);
                float n = Rand() * 0.5f;
                // simulate bandpass by mixing filtered-ish tone
                float tone = 0.2f * Mathf.Sin(2f * Mathf.PI * 340f * t);
                return (n * 0.7f + tone * 0.3f) * e * 0.45f;
            });
        }

        private AudioClip BuildScreech()
        {
            return CreateClip("screech", 2.0f, (t, u) =>
            {
                float f = Mathf.Lerp(1800f, 220f, Mathf.Pow(u, 2f));
                float s = SawOsc(f, t) * 0.7f;
                float e = u < 0.05f ? u / 0.05f : (1f - u);
                return (s + 0.3f * Rand()) * e * 0.85f;
            });
        }

        private AudioClip BuildStinger()
        {
            return CreateClip("stinger", 1.3f, (t, u) =>
            {
                float f = Mathf.Lerp(90f, 40f, u);
                float s = 0.8f * Mathf.Sin(2f * Mathf.PI * f * t);
                float noise = 0.35f * Rand();
                float e = Mathf.Exp(-t * 1.3f);
                return (s + noise) * e;
            });
        }

        private AudioClip BuildHeartbeat()
        {
            return CreateClip("heart", 0.35f, (t, u) =>
            {
                // two thuds: lub-dub
                float sub = 0f;
                if (t < 0.12f) sub = 0.8f * Mathf.Sin(2f * Mathf.PI * 60f * t) * Mathf.Exp(-t * 14f);
                else if (t > 0.14f && t < 0.25f) sub = 0.55f * Mathf.Sin(2f * Mathf.PI * 55f * (t - 0.14f)) * Mathf.Exp(-(t - 0.14f) * 15f);
                return sub;
            });
        }

        private AudioClip BuildBreath()
        {
            return CreateClip("breath", 0.6f, (t, u) =>
            {
                float e = Mathf.Sin(Mathf.PI * u);
                return Rand() * 0.35f * e;
            });
        }

        private AudioClip BuildGlassBreak()
        {
            return CreateClip("glass", 0.7f, (t, u) =>
            {
                float thud = t < 0.08f ? 0.5f * Mathf.Sin(2f * Mathf.PI * 220f * t) * (1f - t / 0.08f) : 0f;
                float shards = 0f;
                if (t > 0.02f && t < 0.5f)
                {
                    float freq = 2500f + Mathf.PerlinNoise(t * 40f, 0) * 5000f;
                    shards = 0.35f * Mathf.Sin(2f * Mathf.PI * freq * t) * Mathf.Exp(-(t - 0.02f) * 5f);
                    shards += 0.25f * Rand() * Mathf.Exp(-(t - 0.02f) * 4f);
                }
                return thud + shards;
            });
        }

        private AudioClip BuildMetalClang()
        {
            return CreateClip("metal", 0.8f, (t, u) =>
            {
                float thud = t < 0.05f ? 0.5f * Rand() : 0f;
                float ring = 0f;
                if (t < 0.7f)
                {
                    float e = Mathf.Exp(-t * 3.2f);
                    ring = 0.3f * Mathf.Sin(2f * Mathf.PI * 1200f * t) * e
                         + 0.18f * Mathf.Sin(2f * Mathf.PI * 2400f * t) * e
                         + 0.12f * Mathf.Sin(2f * Mathf.PI * 3750f * t) * e;
                }
                return thud + ring;
            });
        }

        private AudioClip BuildWoodThud()
        {
            return CreateClip("wood", 0.35f, (t, u) =>
            {
                float e = Mathf.Exp(-t * 9f);
                return (0.5f * Mathf.Sin(2f * Mathf.PI * 180f * t) + 0.3f * Rand()) * e;
            });
        }

        private AudioClip BuildPickup(float f1, float f2)
        {
            return CreateClip("pick", 0.18f, (t, u) =>
            {
                float a = t < 0.08f ? Mathf.Sin(2f * Mathf.PI * f1 * t) * (1f - t / 0.08f) : 0f;
                float b = (t > 0.06f && t < 0.16f) ? Mathf.Sin(2f * Mathf.PI * f2 * (t - 0.06f)) * Mathf.Exp(-(t - 0.06f) * 20f) : 0f;
                return 0.35f * (a + b);
            });
        }

        private AudioClip BuildWhoosh()
        {
            return CreateClip("whoosh", 0.35f, (t, u) =>
            {
                float e = Mathf.Sin(Mathf.PI * u);
                float freq = 900f - 300f * u;
                float tone = 0.2f * Mathf.Sin(2f * Mathf.PI * freq * t);
                return (Rand() * 0.25f + tone) * e;
            });
        }

        private AudioClip BuildDoorOpen()
        {
            return CreateClip("door", 0.7f, (t, u) =>
            {
                float creak = 0.25f * Mathf.Sin(2f * Mathf.PI * (400f + 200f * Mathf.Sin(t * 8f)) * t) * Mathf.Exp(-(1f - u));
                float noise = Rand() * 0.18f;
                float thud = t > 0.55f ? 0.4f * Mathf.Sin(2f * Mathf.PI * 120f * (t - 0.55f)) * Mathf.Exp(-(t - 0.55f) * 15f) : 0f;
                return creak + noise * 0.3f + thud;
            });
        }

        private AudioClip BuildLockerOpen()
        {
            return CreateClip("locker", 0.45f, (t, u) =>
            {
                float metal = 0.3f * Mathf.Sin(2f * Mathf.PI * 1100f * t) * Mathf.Exp(-t * 4f);
                float noise = Rand() * 0.2f * Mathf.Exp(-t * 3f);
                return metal + noise;
            });
        }

        private AudioClip BuildEngineCrank()
        {
            return CreateClip("crank", 0.85f, (t, u) =>
            {
                float rumble = 0.45f * Mathf.Sin(2f * Mathf.PI * 80f * t);
                float noise = Rand() * 0.25f;
                float e = Mathf.Sin(Mathf.PI * u);
                return (rumble + noise) * e * 0.55f;
            });
        }

        private AudioClip BuildEngineStart()
        {
            return CreateClip("engine", 4.2f, (t, u) =>
            {
                float freq = Mathf.Lerp(60f, 180f, Mathf.Clamp01(t / 1.2f));
                float saw = SawOsc(freq, t) * 0.5f;
                float idle = Mathf.Sin(2f * Mathf.PI * 140f * t) * 0.12f;
                float e = t < 0.3f ? t / 0.3f : Mathf.Exp(-(t - 0.3f) * 0.6f);
                float n = Rand() * 0.15f;
                return (saw + idle + n) * e * 0.75f;
            });
        }

        private AudioClip BuildCCTVBoot()
        {
            return CreateClip("cctvb", 0.45f, (t, u) =>
            {
                float b1 = t < 0.2f ? Mathf.Sin(2f * Mathf.PI * 300f * t) * (1f - t / 0.2f) : 0f;
                float b2 = (t > 0.2f && t < 0.4f) ? Mathf.Sin(2f * Mathf.PI * 600f * (t - 0.2f)) * (1f - (t - 0.2f) / 0.2f) : 0f;
                float n = Rand() * 0.12f;
                return 0.35f * (b1 + b2) + n * 0.25f;
            });
        }

        private AudioClip BuildCCTVShutdown()
        {
            return CreateClip("cctvs", 0.5f, (t, u) =>
            {
                float freq = Mathf.Lerp(500f, 120f, u);
                return 0.35f * Mathf.Sin(2f * Mathf.PI * freq * t) * Mathf.Exp(-t * 3f);
            });
        }

        private AudioClip BuildCCTVStatic()
        {
            return CreateClip("cstat", 0.12f, (t, u) => Rand() * 0.35f * Mathf.Sin(Mathf.PI * u));
        }

        private AudioClip BuildDrip()
        {
            return CreateClip("drip", 0.25f, (t, u) =>
            {
                float f = Mathf.Lerp(2400f, 1800f, u);
                return 0.5f * Mathf.Sin(2f * Mathf.PI * f * t) * Mathf.Exp(-t * 20f);
            });
        }

        private AudioClip BuildCreak()
        {
            return CreateClip("creak", 0.8f, (t, u) =>
            {
                float f = 180f + Mathf.PerlinNoise(t * 3f, 0f) * 200f;
                float e = Mathf.Sin(Mathf.PI * u);
                return (0.25f * SawOsc(f, t) + Rand() * 0.15f) * e * 0.6f;
            });
        }

        private AudioClip BuildLightBuzz()
        {
            return CreateClip("buzz", 2.0f, (t, u) =>
            {
                float buzz = 0.08f * Mathf.Sin(2f * Mathf.PI * 120f * t);
                float hum = 0.04f * Mathf.Sin(2f * Mathf.PI * 60f * t);
                return buzz + hum;
            });
        }

        private static float SawOsc(float freq, float t)
        {
            float p = (t * freq) % 1f;
            return 2f * p - 1f;
        }

        private static float LowPassPhase(float t, float amount)
        {
            // Crude phase-smear to fake low-pass on synthesized waves
            return 1f - amount * 0.3f * Mathf.Sin(2f * Mathf.PI * 200f * t);
        }
    }
}
