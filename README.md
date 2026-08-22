# Chitcx — Real-time Conferencing & Collaboration Platform

Chitcx is a real-time messaging, audio, and video conferencing platform, engineered with a full-stack JavaScript architecture using Express, React, Socket.IO, and Mediasoup (WebRTC SFU).

> **Attribution:** The original application layer (chat, calling, and WebRTC functionality)
> is built on a commercial template ("Clover" by Honeyside, via CodeCanyon). All security
> hardening, real-time architecture work, low-network optimization, testing, CI/CD,
> observability, the AI assistant, and this rebrand are original engineering work on top of
> that foundation — see [`DECISIONS.md`](DECISIONS.md) for the full record of what changed
> and why.

---

## 📋 Table of Contents
1. [Project Overview](#1-project-overview)
2. [Technology Stack](#2-technology-stack)
3. [Repository Structure](#3-repository-structure)
4. [Backend Architecture](#4-backend-architecture)
5. [Frontend Architecture](#5-frontend-architecture)
6. [Messaging Architecture](#6-messaging-architecture)
7. [Audio & Video (WebRTC) Architecture](#7-audio--video-webrtc-architecture)
8. [Authentication & Authorization Flow](#8-authentication--authorization-flow)
9. [Admin Panel](#9-admin-panel)
10. [Database Design](#10-database-design)
11. [API Reference](#11-api-reference)
12. [Socket Events](#12-socket-events)
13. [Environment Variables](#13-environment-variables)
14. [Scripts & Automation](#14-scripts--automation)
15. [Documentation Summaries](#15-documentation-summaries)
16. [Deployment Guide](#16-deployment-guide)
17. [Performance Optimizations](#17-performance-optimizations)
18. [Security Features](#18-security-features)
19. [Complete Architecture Visualizations](#19-complete-architecture-visualizations)
20. [Codebase Findings & Recommendations](#20-codebase-findings--recommendations)

---

## 1. Project Overview

*   **Purpose**: To provide a self-hosted, ultra-low latency platform for real-time chat, file sharing, and high-performance WebRTC multi-party audio/video rooms.
*   **Business Goal**: Open-source alternative to Slack/Teams/Zoom, featuring an automated zero-configuration launcher for cloud servers.
*   **Intended Users**: Remote-first teams, organizations requiring private messaging infrastructure, and developers looking for a reference WebRTC implementation.
*   **Supported Platforms**: Modern web browsers (Chrome, Firefox, Safari, Edge) and mobile web interfaces.
*   **Overall Architecture**:
    *   **Frontend**: Single Page Application (SPA) driven by React, Redux, SASS, and `reactn` (global state).
    *   **Backend**: Node.js/Express REST server, Socket.IO messaging gateway, and Mediasoup SFU (Selective Forwarding Unit) media router.
    *   **Databases**: MongoDB (persistent application state) and NeDB (high-speed, in-memory SQLite-like document database for real-time room/peer mappings).

---

## 2. Technology Stack

### Frontend
*   **Core**: React 18 (Vite-bundler), HTML5, JavaScript (ES Modules).
*   **Styling**: SASS, Vanilla CSS, UIKit, Styled-Components.
*   **State Management**: Redux, Redux Thunk, Reactn (simplified global state management).
*   **Realtime**: Socket.io Client (`v2.5.0`), Mediasoup Client (`v3.7.2`).
*   **UI Helpers**: React Icons, React Toastify, React Modal Image, Emoji Mart.

### Backend
*   **Core**: Node.js 18/20, Express (`v4.18.2`).
*   **Realtime**: Socket.IO (`v2.5.0`), Socketio-JWT.
*   **Media Routing (SFU)**: Mediasoup (`v3.13.19`) compiled with C++ native workers.
*   **Authentication**: Passport.js, Passport-JWT, jsonwebtoken, Argon2.
*   **Utilities**: Express Formidable, Sharp, Mongoose, NeDB-Async, Node-Schedule.

### Database
*   **Persistent**: MongoDB (`v6.x.x`), Mongoose ODM.
*   **Volatile/Session**: AsyncNeDB (In-memory file-based document DB).

### Infrastructure & Operations
*   **Web Server / Proxy**: Nginx (Reverse Proxy with SSL certificates via Let's Encrypt).
*   **Process Management**: PM2.
*   **Containerization**: Docker (Configurable via Dockerfiles, if needed).

---

## 3. Repository Structure

```
/
├── backend/                  # Express REST API, Socket.IO & Mediasoup SFU media server
├── frontend/                 # React frontend application built with Vite & SASS
├── documentation/            # Static deployment guides and online documentation portal redirects
├── scripts/                  # Multi-node automation installers and configuration scripts
├── launcher                  # Root bash shell entry-point script for Ubuntu deployment setup
├── package.json              # Root workspace metadata
├── documentation.pdf         # Original template manual (Honeyside/Clover, kept for reference)
├── README.md                 # Project documentation
├── .gitignore                # Global git ignore filters
└── .honeyignore              # Target exclusion rules for specific build/package processes
```

---

## 4. Backend Architecture

### Folder Architecture
*   `backend/src/init.js`: Core initialization script mounting database hookups, Passport JWT auth policies, CORS filters, multi-part form handlers, Socket.IO listeners.
*   `backend/src/store.js`: Singleton in-memory application context hosting references to active WebRTC peers, Socket.IO server hooks, database connections.
*   `backend/src/mediasoup/index.js`: SFU lifecycle orchestrator handling Worker threads, WebRtcTransport allocations, Producers, Consumers.
*   `backend/src/models/`: MongoDB ODM schemas (Users, Rooms, Messages, Meetings, Emails, AuthCodes).
*   `backend/src/routes/`: Express controller handlers structured by concerns (Authentication, Meeting sessions, Media uploads, Chat channels).
*   `backend/src/events/`: Real-time Socket.IO handler routing (status syncing, pagination offsets).
*   `backend/src/utils/`: Common helpers (mailing templates, validator utils).

### HTTP Request Pipeline Flow
```
Client Request
      ↓
[Express Middleware] (CORS, Express-Formidable)
      ↓
[Passport JWT Strategy] (Token Validation & User Context binding)
      ↓
[Router Mapper] (Routes selection under /api/...)
      ↓
[Controller Actions] (Business Logic inside specific endpoint)
      ↓
[Mongoose ODM / MongoDB] (Persistent storage reads/writes)
      ↓
JSON Response
```

---

## 5. Frontend Architecture

### Folder Structure
*   `frontend/src/main.jsx`: Vite application startup mounting the React virtual DOM.
*   `frontend/src/App.jsx`: Global router layout, theme injection, active notifications, away-state timers.
*   `frontend/src/init.js`: Application setup script reading stored token, verifying authenticity with `/check-user`, and initializing Reactn store.
*   `frontend/src/store.js`: Redux store instantiation using Redux-Thunk middleware.
*   `frontend/src/actions/` & `frontend/src/reducers/`: Socket.IO actions, session state.
*   `frontend/src/features/`: Component modules segregated by functional domain:
    *   `Admin/`: Management screens for moderating users.
    *   `Conversation/`: Main text chat UI, file uploads, emojis.
    *   `Details/`: User metadata profile panels.
    *   `Group/`: Creation dialogues for group channels.
    *   `Meeting/`: Video/Audio conferencing rooms, screensharing tracks.
    *   `Panel/`: Workspace navigation bar.
    *   `Welcome/`: New user onboard state.
*   `frontend/src/pages/`: Page containers (`Login`, `ForgotPassword`, `Home`).

### React Component Hierarchy
```
App (Routes, Theme Manager, ToastContainer)
      ↓
BrowserRouter (React Router DOM)
      ↓
Home Page (Main Dashboard Context)
      ├── Panel Feature (Sidebar channels list & user details)
      ├── Conversation Feature (Chat log, message input, upload attachments)
      └── Meeting Feature (WebRTC conference window, grid tiles of audio/video streams)
```

---

## 6. Messaging Architecture

Chitcx employs a hybrid transport system: Express REST for structural transactions (registering user accounts, creating group objects) and Socket.IO for reactive events (instant messaging, typing notifications, statuses).

```
Client (Sender)
      ↓ (HTTP POST /api/message)
Express Server
      ↓
Message Controller (Persists to MongoDB)
      ↓
Socket.IO Broadcast (Emits to roomId namespace)
      ↓
Client (Receiver)
```

### Connection Lifecycle
1.  **Authorization**: Client initiates a Socket.IO connection. The handshake is intercepted by `socketio-jwt` which decodes the Bearer token in the query context.
2.  **Instantiation**: Upon valid authentication, the connection is bound to a User ID, joined to the user's private namespace, and status is set to `online`.
3.  **Real-Time Sync**: Events are attached via `events/index.js` (e.g. status changes, loading older messages).
4.  **Graceful Disconnect**: Disconnect triggers cleanup: removing Socket IDs from lists, changing user status to `offline`/`lastOnline` timestamp.

---

## 7. Audio & Video (WebRTC) Architecture

Mediasoup functions as a **Selective Forwarding Unit (SFU)**. Instead of peer-to-peer mesh links, all media is forwarded through the server.

```
[Peer A (Producer)]                           [Mediasoup Router (SFU)]                   [Peer B (Consumer)]
        │                                                │                                        │
        │─── 1. socket: getRouterRtpCapabilities ──────>│                                        │
        │<── 2. router capabilities returns ─────────────│                                        │
        │                                                │                                        │
        │─── 3. socket: createProducerTransport ────────>│                                        │
        │<── 4. transport parameters returned ───────────│                                        │
        │                                                │                                        │
        │─── 5. socket: produce (audio/video track) ────>│                                        │
        │<── 6. producer ID returned ────────────────────│                                        │
        │                                                │                                        │
        │                                                │─── 7. socket: newProducer broadcast ──>│
        │                                                │                                        │
        │                                                │<── 8. socket: createConsumerTransport ─│
        │                                                │─── 9. transport parameters returned ──>│
        │                                                │                                        │
        │                                                │<── 10. socket: consume (producer ID) ──│
        │                                                │─── 11. consumer media stream tracks ──>│
```

---

## 8. Authentication Flow

Authentication uses JWT tokens signed with SHA-256 via `jsonwebtoken` and validated on endpoints using `passport-jwt`.

```
User (Login UI) ──> POST /api/login ──> Password compared via Argon2
                                                   │
    ┌───────────────── Auth Successful ────────────┴────────── Auth Failed ────┐
    ↓                                                                          ↓
JWT generated (Payload: id, email, level)                               401 Error response
Returned in Response Object
Stored in localStorage
Mounted as Bearer Token on future Axios calls
```

### Route Authorization Levels
*   **Standard Users**: Can read rooms, upload files, join video conferences, edit their own profile.
*   **Root Users**: Assigned to user accounts possessing `level: "root"`. Root status allows user deletion via `/api/user/delete`, system configuration, and visibility of the admin management dashboard.

---

## 9. Admin Panel

The Admin Panel (`frontend/src/features/Admin`) is a dedicated view accessible only to users marked as `root`.
*   **User Management Table**: Integrates `react-data-table-component` displaying email, username, permissions level, and last online activity status.
*   **User Lifecycle Administration**: Provisioning new profiles, modifying roles (`standard` ↔ `root`), and processing account deletions.
*   **Moderation Controls**: Real-time deletion of rooms and messages.

---

## 10. Database Design

MongoDB houses the persistent storage schemas, while NeDB manages active media transports in-memory.

### Mongoose Schemas (Persistent MongoDB)

```
User
 ├── email (String)
 ├── username (String)
 ├── password (Hash, Argon2)
 ├── level (String: "standard" | "root")
 ├── favorites (Array → Room Refs)
 └── picture (Image Ref)

Room (Channel/Direct Message)
 ├── people (Array → User Refs)
 ├── title (String)
 ├── isGroup (Boolean)
 ├── lastUpdate (Date)
 └── lastMessage (Message Ref)

Message
 ├── author (User Ref)
 ├── content (String)
 ├── file (File Ref)
 └── room (Room Ref)

Meeting (Video Call)
 ├── caller (User Ref)
 ├── callee (User Ref)
 ├── peers (Array of Socket IDs)
 └── users (Array → User Refs)
```

---

## 11. API Reference

| Method | Route | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/login` | Compares email/password, returns JWT token. | No |
| `POST` | `/api/register` | Registers a new standard user account. | No |
| `POST` | `/api/check-user` | Validates User ID token validity. | No |
| `POST` | `/api/upload` | Uploads an image. Returns image metadata object. | Yes (JWT) |
| `POST` | `/api/upload/file` | Uploads raw documents/attachments. | Yes (JWT) |
| `POST` | `/api/picture/change` | Updates the authenticated user's profile image. | Yes (JWT) |
| `POST` | `/api/room/create` | Spawns a direct messaging channel. | Yes (JWT) |
| `POST` | `/api/group/create` | Spawns a multi-peer chat room. | Yes (JWT) |
| `POST` | `/api/meeting/call` | Starts an active audio/video meeting context. | Yes (JWT) |
| `POST` | `/api/meeting/close` | Terminates a conference session. | Yes (JWT) |
| `POST` | `/api/user/delete` | Deletes a user profile (Requires root access level). | Yes (JWT) |

---

## 12. Socket Events

| Client-Side Event | Server Handling | Result / DB Operations | Broadcast |
| :--- | :--- | :--- | :--- |
| `status` | Updates online status | Set status in memory, updates last online | Broadcasts `onlineUsers` |
| `getRouterRtpCapabilities` | Returns Mediasoup codecs | No database action | None |
| `createProducerTransport` | Spawns WebRtcTransport | Inserts transport ID into `producerTransports` | None |
| `produce` | Starts sending track | Inserts peer document into `store.peers` NeDB | Broadcasts `newProducer` |
| `consume` | Starts receiving track | Retrieves target transport, builds consumer | None |
| `join` | Joins a media room | Updates active peer socket arrays in MongoDB | Emits `newPeer` |
| `leave` | Leaves a media room | Clears socket references from MongoDB & NeDB | Emits `leave` |

---

## 13. Environment Variables

### Backend Configuration (`backend/.env`)
*   `PORT` (Default: `4000`): Port Express server binds to.
*   `PUBLIC_IP_ADDRESS`: External public IP address of host. Essential for WebRTC routing.
*   `MAPPED_IP` (Default: `false`): If using NAT mapping (AWS, Google Cloud), set to `true`.
*   `AUTH_SECRET`: Secret key for signing JWT authorization headers.
*   `ROOT_USER_EMAIL` / `ROOT_USER_PASSWORD`: Default credentials created on startup.
*   `MONGO_URI`: Complete MongoDB connection URI (e.g. `mongodb://localhost:27017/chitcx`).
*   `MAILER_ENABLED` (Default: `false`): Enables email delivery cron tasks.

### Frontend Configuration (`frontend/.env`)
*   `VITE_SITE_TITLE`: Website browser title.
*   `VITE_SITE_BRAND`: Layout branding text label.
*   `VITE_BACKEND_URL`: Absolute URL of the running backend server.
*   `VITE_DEMO` (Default: `false`): Limits certain profile edit endpoints when true.

---

## 14. Scripts & Automation

### Workspace Root Scripts (`package.json`)
*   No workspace tasks. Individual workspaces run independent scripts.

### Backend Scripts (`backend/package.json`)
*   `npm start`: Runs server using `node index.js`.
*   `npm run format:check`: Validates Prettier rules compliance.
*   `npm run format:write`: Formats the entire backend repository.

### Frontend Scripts (`frontend/package.json`)
*   `npm run dev` / `npm start`: Runs local Vite hot-reload server.
*   `npm run build`: Compiles application into optimized static assets under `/dist`.
*   `npm run lint:check` / `npm run lint:fix`: Code quality validations.

---

## 15. Documentation Summaries

*   **`documentation/README.md`**: Summarizes resource links where updates, changelogs, and official deployment announcements are posted.
*   **`documentation/online.url`**: URL redirect asset from the original template, pointing to the Honeyside/Clover publishing channel (kept for attribution).
*   **`documentation.pdf`**: User handbook covering administrative features and setup tips.

---

## 16. Deployment Guide

### Local Development
1.  **Configure environment files** by creating `.env` files in both folders using the respective `.env.example` templates.
2.  **Start Services**:
    ```bash
    # Terminal 1: Backend
    cd backend
    npm install
    npm start

    # Terminal 2: Frontend
    cd frontend
    npm install
    npm run dev
    ```

### Production Setup (Ubuntu Server Setup via Launcher)
For Ubuntu VPS deployments, Chitcx includes a automated launcher script:
1.  Run the launcher command to trigger the build flow:
    ```bash
    ./launcher setup
    ```
2.  The launcher script will install standard packages: `build-essential`, `python3`, `python3-pip`, `nvm` (Node.js 18), `yarn`, `pm2`, and `nginx`.
3.  It will install MongoDB 6.0 and start the service daemon.
4.  It prompts for domain, SSL email, public IP parameters, and auto-builds the React frontend.
5.  It configures Nginx, obtains Let's Encrypt certificates automatically, and registers backend execution under PM2 process supervisor.

---

## 17. Performance Optimizations

*   **Selective Forwarding Unit (SFU)**: Media is forwarded only to active users in a meeting, avoiding high CPU overhead.
*   **Lazy Loading**: Pages and tabs (such as administrative tables) are loaded on-demand.
*   **Database Partitioning**: NeDB handles high-frequency in-memory WebRTC state transactions (saving MongoDB write overhead).
*   **Asset Processing**: The Express controller imports `sharp` to resize and compress uploaded avatars.

---

## 18. Security Features

*   **Argon2 Hashing**: Cryptographic password hashing protection.
*   **XSS Protection**: Inputs are scrubbed using the `xss` library to prevent script injection.
*   **JWT Handshakes**: Both HTTP API requests and Socket.IO handshakes are secured using encrypted JSON Web Tokens.
*   **Upload Shields**: File upload paths map files to randomly generated UUIDs, masking original extensions and physical locations.

---

## 19. Complete Architecture Visualizations

### High-Level Architecture
```
[User Browser] ──(WebRTC Peer Connections)──> [Mediasoup Media Server]
      │                                                ▲
 (HTTP & WebSockets)                                   │
      │                                                │
      ▼                                                │
[React Frontend (Vite)] ───────────────────────────────┘
      │
      ▼
[Express Server] ──(Authentication / JWT)──> [Argon2 Password Hashing]
      │
      ▼
[Mongoose ODM]
      ├─► MongoDB (User profiles, chats, meeting history)
      └─► AsyncNeDB (In-memory WebRTC active connections list)
```

---

## 20. Codebase Findings & Recommendations

1.  **Hardcoded Mailer State**: `config.js` sets `nodemailerEnabled = false` directly. The environment variable `MAILER_ENABLED` is ignored, preventing email features from running unless modified in code.
    *   *Fix*: Update line 32 in `backend/config.js` to read: `nodemailerEnabled: process.env.MAILER_ENABLED === 'true'`.
2.  **Old Socket.io Protocol Version**: The project uses Socket.IO `2.5.0`, which uses an older protocol than modern versions (v4.x).
    *   *Fix*: Upgrade `socket.io` and `socket.io-client` dependencies.
3.  **NeDB Active State Isolation**: NeDB works well for single-node setups but limits horizontal scaling (since state is kept in local memory).
    *   *Fix*: For clustered environments, migrate transport tracking to Redis.
