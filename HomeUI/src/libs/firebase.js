import firebase from 'firebase/compat/app';

const firebaseConfig = {
  apiKey: 'AIzaSyAtMsozWwJhhPIOd9BGkZxk5D6Wr8jVGVM',
  authDomain: 'fluxcore-prod.firebaseapp.com',
  projectId: 'fluxcore-prod',
  storageBucket: 'fluxcore-prod.appspot.com',
  messagingSenderId: '468366888401',
  appId: '1:468366888401:web:56eb34ebe93751527ea4f0',
  measurementId: 'G-SEGT3X2737',
};

// Initialize Firebase
const firebaseApp = firebase.initializeApp(firebaseConfig);

export function getUser() {
  try {
    return firebaseApp.auth().currentUser;
  } catch (error) {
    return null;
  }
}

export default firebaseApp;
