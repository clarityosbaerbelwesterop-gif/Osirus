import { createRemoteJWKSet, jwtVerify } from "jose";import { env } from "../env";
export type AuthIdentity={userId:string;email?:string};
export async function verifyBearer(token:string):Promise<AuthIdentity>{if(!env.NEON_AUTH_JWKS_URL)throw new Error("NEON_AUTH_JWKS_URL is not configured");const jwks=createRemoteJWKSet(new URL(env.NEON_AUTH_JWKS_URL));const {payload}=await jwtVerify(token,jwks,{clockTolerance:5});if(typeof payload.sub!=="string")throw new Error("invalid_session");return {userId:payload.sub,email:typeof payload.email==="string"?payload.email:undefined}}
