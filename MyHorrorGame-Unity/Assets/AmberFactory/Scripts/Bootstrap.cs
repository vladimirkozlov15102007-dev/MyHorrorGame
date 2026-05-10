using UnityEngine;
using UnityEngine.SceneManagement;

namespace AmberFactory
{
    /// <summary>
    /// Entry point. Runs before any scene loads, creates an empty scene if needed,
    /// and spawns the GameManager which assembles the whole game procedurally.
    /// This avoids shipping a broken .unity asset — everything is built in code.
    /// </summary>
    public static class Bootstrap
    {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        private static void Init()
        {
            Application.targetFrameRate = 60;
            QualitySettings.vSyncCount = 1;

            // If the user opened an empty project, there's still a default scene.
            // We just attach our GameManager to a persistent object.
            var go = new GameObject("[AmberFactory]");
            Object.DontDestroyOnLoad(go);
            go.AddComponent<GameManager>();
        }
    }
}
