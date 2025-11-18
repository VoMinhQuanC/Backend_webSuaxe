// auth0Config.js - Cấu hình Auth0
const dotenv = require('dotenv');
dotenv.config();

module.exports = {
  authRequired: false,
  auth0Logout: true,
  baseURL: process.env.BASE_URL || 'http://localhost:3001',
  clientID: process.env.AUTH0_CLIENT_ID,
  issuerBaseURL: `https://${process.env.AUTH0_DOMAIN}`,
  clientSecret: process.env.AUTH0_CLIENT_SECRET,
  secret: process.env.SESSION_SECRET || 'suaxe_secret',
  authorizationParams: {
    response_type: 'code',
    scope: 'openid profile email'
  }
};