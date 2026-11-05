// A verified Google app session must match the server-configured operator
// account. The friend code is only an identity selector, NOT an access token.
// Showing or guessing the code never grants permission without that session.
export function isOperatorAccount(account,configuredCode){
 if(!account||typeof configuredCode!=='string')return false;
 const expected=configuredCode.trim().toUpperCase();
 if(!/^ST-[0-9A-F]{10}$/.test(expected))return false;
 return account.code===expected;
}

// Separate, testable route to prevent accidental unauthenticated access to
// operator presentation privileges. No virtual/human split is added to public
// REST responses. The room socket continues supplying presence for 3D avatars.
export function createOperatorAPI({accounts,accountContext,json,sameOrigin,permit,configuredCode}){
 return async function(req,res,pathname){
  if(pathname!=='/api/operator/access')return false;
  if(req.method!=='GET')return json(res,405,{error:'Method not allowed'}),true;
  if(!sameOrigin(req))return json(res,403,{error:'Wrong origin'}),true;
  if(!permit(req,'operator-access',30))return json(res,429,{error:'Too many requests'}),true;
  const ctx=await accountContext(req,accounts);
  if(!ctx)return json(res,401,{error:'Google authentication required'}),true;
  const profile=await accounts.account(ctx.id);
  if(!isOperatorAccount(profile,configuredCode))return json(res,403,{error:'Forbidden'}),true;
  return json(res,200,{authorized:true}),true;
 };
}
