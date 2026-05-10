using UnityEngine;

namespace AmberFactory
{
    /// <summary>
    /// A locker the player can hide inside. Works with PlayerController.Hide().
    /// The door rotates open/closed cosmetically.
    /// </summary>
    public class HidingSpot : MonoBehaviour
    {
        public Transform Door;
        public Vector3 EntryOffset; // relative to transform, in local space
        public bool Occupied;

        public Vector3 EntryWorldPos => transform.TransformPoint(EntryOffset);

        public void PlayOpen()
        {
            if (Door == null) return;
            Door.localRotation = Quaternion.Euler(0, 80, 0);
            Invoke(nameof(CloseDoor), 0.5f);
        }

        private void CloseDoor()
        {
            if (Door != null) Door.localRotation = Quaternion.identity;
        }
    }
}
