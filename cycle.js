services:
  - type: web
    name: decormind-engine
    env: node
    plan: free
    buildCommand: npm install
    startCommand: node src/index.js
    healthCheckPath: /health
    envVars:
      - key: PORT
        value: 10000
      - key: NODE_ENV
        value: production
      - key: GROQ_API_KEY
        sync: false
      - key: CJ_API_KEY
        sync: false
      - key: CJ_PUBLISHER_ID
        sync: false
      - key: SHAREASALE_API_TOKEN
        sync: false
      - key: SHAREASALE_AFFILIATE_ID
        sync: false
      - key: SHAREASALE_SECRET_KEY
        sync: false
      - key: MAKE_PINTEREST_WEBHOOK_URL
        sync: false
      - key: MAKE_INSTAGRAM_WEBHOOK_URL
        sync: false
      - key: MAKE_YOUTUBE_WEBHOOK_URL
        sync: false
      - key: MAKE_REDDIT_WEBHOOK_URL
        sync: false
      - key: MAKE_TWITTER_WEBHOOK_URL
        sync: false
      - key: MAKE_LINKEDIN_WEBHOOK_URL
        sync: false
      - key: MAKE_FACEBOOK_WEBHOOK_URL
        sync: false
      - key: UNSPLASH_ACCESS_KEY
        sync: false
      - key: SUPABASE_URL
        sync: false
      - key: SUPABASE_SERVICE_ROLE_KEY
        sync: false
      - key: TRIGGER_SECRET
        sync: false
      - key: APP_URL
        sync: false
