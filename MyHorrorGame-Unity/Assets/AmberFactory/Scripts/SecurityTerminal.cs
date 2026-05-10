using UnityEngine;

namespace AmberFactory
{
    /// <summary> Interaction marker for the security desk. </summary>
    public class SecurityTerminal : MonoBehaviour
    {
        public Vector3 InteractPos;
        public float InteractRange = 1.6f;

        public bool InRange(Vector3 playerPos)
        {
            return Vector3.Distance(playerPos, InteractPos) < InteractRange;
        }
    }
}
