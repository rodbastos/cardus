// lib/firebase.js
import { initializeApp } from "firebase/app";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyDsqb9oRcaPYOmWtgbA2G5cxwdx89i0M28",
  authDomain: "cardus-bb94f.firebaseapp.com",
  projectId: "cardus-bb94f",
  storageBucket: "cardus-bb94f.firebasestorage.app",
  messagingSenderId: "657604854110",
  appId: "1:657604854110:web:8fac1bc65d543808c30fcf",
  measurementId: "G-8KNH9EN39F"
};

const app = initializeApp(firebaseConfig);

// Exportar o storage para usarmos nos uploads
export const storage = getStorage(app);
