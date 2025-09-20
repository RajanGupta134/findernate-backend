import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

// A service class for Token generation and management
class TokenService {
    static #app_access_key = process.env.HMS_ACCESS_KEY;
    static #app_secret = process.env.HMS_SECRET;
    #managementToken;

    constructor() {
        this.#managementToken = this.getManagementToken(true);
    }

    // A private method that uses JWT to sign the payload with APP_SECRET
    #signPayloadToToken(payload, expiresIn = '24h') {
        const token = jwt.sign(
            payload,
            TokenService.#app_secret,
            {
                algorithm: 'HS256',
                expiresIn,
                jwtid: uuidv4()
            }
        );
        return token;
    }

    // A private method to check if a JWT token has expired or going to expire soon
    #isTokenExpired(token) {
        try {
            const { exp } = jwt.decode(token) || {};
            const buffer = 30; // generate new if it's going to expire soon (30 seconds)
            const currTimeSeconds = Math.floor(Date.now() / 1000);
            return !exp || exp + buffer < currTimeSeconds;
        } catch (err) {
            console.log("Error in decoding token", err);
            return true;
        }
    }

    // Generate new Management token, if expired or forced
    getManagementToken(forceNew = false) {
        if (forceNew || !this.#managementToken || this.#isTokenExpired(this.#managementToken)) {
            const payload = {
                access_key: TokenService.#app_access_key,
                type: 'management',
                version: 2,
                iat: Math.floor(Date.now() / 1000),
                nbf: Math.floor(Date.now() / 1000)
            };
            this.#managementToken = this.#signPayloadToToken(payload, '24h');
            console.log('🔑 Generated new management token');
        }
        return this.#managementToken;
    }

    // Generate new Auth token for a peer
    getAuthToken({ room_id, user_id, role = 'participant' }) {
        const payload = {
            access_key: TokenService.#app_access_key,
            room_id: room_id,
            user_id: user_id,
            role: role,
            type: 'app',
            version: 2,
            iat: Math.floor(Date.now() / 1000),
            nbf: Math.floor(Date.now() / 1000)
        };
        console.log(`🔑 Generated auth token for user ${user_id} in room ${room_id} with role ${role}`);
        return this.#signPayloadToToken(payload, '1h'); // Shorter expiry for auth tokens
    }

    // Validate if a token is still valid
    isTokenValid(token) {
        return !this.#isTokenExpired(token);
    }
}

export { TokenService };