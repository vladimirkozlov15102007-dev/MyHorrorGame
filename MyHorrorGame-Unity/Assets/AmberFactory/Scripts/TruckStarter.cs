using UnityEngine;

namespace AmberFactory
{
    /// <summary>
    /// The yellow KAMAZ escape vehicle. Mini-game: hold E to insert key → crank → crank → ROAR.
    /// On success, drives the player away and triggers the win state.
    /// </summary>
    public class TruckStarter : MonoBehaviour
    {
        public Vector3 Position;
        public Vector3 InteractPos;
        public bool Started;
        public int Step;             // 0..3
        public float Progress;       // 0..1
        public bool Active;
        public float PromptTimer;

        public float DriveTimer;
        public Light HeadlightL;
        public Light HeadlightR;

        public bool IsRunning => Started;

        public bool TryStartActivate(int keyCount)
        {
            if (Started) return false;
            if (keyCount < 3) return false;
            if (Active) return false;
            Active = true;
            Step = 0;
            Progress = 0;
            ProceduralAudio.Instance.PlayOneShot3D(ProceduralAudio.Instance.DoorOpen, InteractPos);
            return true;
        }

        public void HoldProgress(float dt)
        {
            if (!Active || Started) return;
            Progress += dt * 0.4f;
            PromptTimer += dt;

            if (Step == 0) // insert keys
            {
                if (Progress >= 1f)
                {
                    Step = 1; Progress = 0;
                }
            }
            else if (Step == 1)
            {
                if (PromptTimer > 0.6f) { PromptTimer = 0; ProceduralAudio.Instance.PlayOneShot3D(ProceduralAudio.Instance.EngineCrank, Position); }
                if (Progress >= 1f) { Step = 2; Progress = 0; }
            }
            else if (Step == 2)
            {
                if (PromptTimer > 0.55f) { PromptTimer = 0; ProceduralAudio.Instance.PlayOneShot3D(ProceduralAudio.Instance.EngineCrank, Position); }
                if (Progress >= 1f)
                {
                    Step = 3;
                    Started = true;
                    ProceduralAudio.Instance.PlayOneShot3D(ProceduralAudio.Instance.EngineStart, Position, 1.2f, 1f, 5f, 80f);
                    SpawnHeadlights();
                }
            }
        }

        public string CurrentStepLabel(int keyCount)
        {
            if (keyCount < 3) return $"NEED ALL 3 KEYS ({keyCount}/3)";
            if (!Active) return "ENTER TRUCK [E]";
            if (Started) return "ENGINE RUNNING · DRIVE!";
            string label = Step == 0 ? "Inserting key..." :
                           Step == 1 ? "Cranking..." :
                           "Cranking harder...";
            return $"HOLD [E] · {label} {Mathf.RoundToInt(Progress * 100)}%";
        }

        private void SpawnHeadlights()
        {
            var lg = new GameObject("Headlight_L");
            lg.transform.SetParent(transform, false);
            lg.transform.localPosition = new Vector3(-0.8f, 1.35f, 1.5f);
            lg.transform.localRotation = Quaternion.identity;
            HeadlightL = lg.AddComponent<Light>();
            HeadlightL.type = LightType.Spot;
            HeadlightL.color = new Color(1f, 0.97f, 0.85f);
            HeadlightL.intensity = 5f;
            HeadlightL.range = 35f;
            HeadlightL.spotAngle = 55f;
            HeadlightL.shadows = LightShadows.Soft;

            var rg = new GameObject("Headlight_R");
            rg.transform.SetParent(transform, false);
            rg.transform.localPosition = new Vector3(0.8f, 1.35f, 1.5f);
            HeadlightR = rg.AddComponent<Light>();
            HeadlightR.type = LightType.Spot;
            HeadlightR.color = new Color(1f, 0.97f, 0.85f);
            HeadlightR.intensity = 5f;
            HeadlightR.range = 35f;
            HeadlightR.spotAngle = 55f;
            HeadlightR.shadows = LightShadows.Soft;
        }

        public void ResetState()
        {
            Started = false;
            Step = 0;
            Progress = 0;
            Active = false;
            DriveTimer = 0;
            if (HeadlightL) { Destroy(HeadlightL.gameObject); HeadlightL = null; }
            if (HeadlightR) { Destroy(HeadlightR.gameObject); HeadlightR = null; }
        }

        /// <summary> Called by GameManager each frame once Started to animate escape. </summary>
        public void AnimateEscape(float dt, Transform player)
        {
            if (!Started) return;
            DriveTimer += dt;
            float speed = Mathf.Min(12f, DriveTimer * 4f);
            transform.position += new Vector3(1, 0, 0) * speed * dt; // drive +X (towards yard exit)
            // Stick the player camera to the cab
            player.position = transform.position + new Vector3(-0.5f, 1.7f, -1.5f);
        }
    }
}
