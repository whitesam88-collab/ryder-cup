import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc, onSnapshot } from "firebase/firestore";

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

const DOC_REF = () => doc(db, "trips", "rydercup-v1");

export async function storageGet() {
  try {
    const snap = await getDoc(DOC_REF());
    if (snap.exists()) return snap.data();
    return null;
  } catch (e) {
    console.error("storageGet error:", e);
    return null;
  }
}

export async function storageSet(data) {
  try {
    await setDoc(DOC_REF(), data);
  } catch (e) {
    console.error("storageSet error:", e);
  }
}

// Subscribe to real-time updates. Returns an unsubscribe function.
export function storageSubscribe(callback) {
  return onSnapshot(DOC_REF(), (snap) => {
    if (snap.exists()) callback(snap.data());
  }, (e) => console.error("storageSubscribe error:", e));
}
