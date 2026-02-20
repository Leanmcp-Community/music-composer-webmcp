import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCQAdmQlJZ3pCT2ylvvNJd3pPkNcf44L5s",
  authDomain: "serverless-mcp.firebaseapp.com",
  projectId: "serverless-mcp",
  storageBucket: "serverless-mcp.firebasestorage.app",
  messagingSenderId: "71099024867",
  appId: "1:71099024867:web:df0044986368aff2060cd6",
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const db = getFirestore(app);
