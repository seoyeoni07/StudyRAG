import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyDLjnqoqSUnJr7NwqymrDHFxI-SxBRiyFg",
  authDomain: "studyrag-d29f9.firebaseapp.com",
  projectId: "studyrag-d29f9",
  storageBucket: "studyrag-d29f9.firebasestorage.app",
  messagingSenderId: "338092764540",
  appId: "1:338092764540:web:2b56f9860da913c3a608f9",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

const provider = new GoogleAuthProvider();

export const loginWithGoogle = () => signInWithPopup(auth, provider);
export const logout = () => signOut(auth);
