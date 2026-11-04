// Firebase Admin SDK is loaded only when FIREBASE_PROJECT_ID is configured.
// Test code may inject an in-memory verifier; production never accepts an
// asserted client UID, unsigned JWT, email address, or a mock environment flag.
export async function createFirebaseVerifier() {
 const projectId=process.env.FIREBASE_PROJECT_ID;
 if(!projectId)return null;
 const [{initializeApp,applicationDefault,cert,getApps},{getAuth}]=await Promise.all([import('firebase-admin/app'),import('firebase-admin/auth')]);
 // Railway: place service-account JSON in a secret environment variable, NOT Git.
 // Codespaces: retain GOOGLE_APPLICATION_CREDENTIALS pointing outside the repo.
 const raw=process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
 const credential=raw?cert(JSON.parse(raw)):applicationDefault();
 const app=getApps()[0]||initializeApp({credential,projectId});
 const fb=getAuth(app);
 return {async verify(idToken){
   if(typeof idToken!=='string'||idToken.length>10000)throw new Error('Invalid token');
   // Both project and Google provider verification are mandatory.
   const claims=await fb.verifyIdToken(idToken,true);
   if(!claims.uid||claims.aud!==projectId||claims.iss!==`https://securetoken.google.com/${projectId}`||claims.firebase?.sign_in_provider!=='google.com')throw new Error('Invalid Firebase project/provider');
   return {uid:claims.uid};
  },async deleteProviderUser(uid){await fb.deleteUser(uid);}};
}
