# Chattr 

A realtime messaging, audio & video conferencing web application. Built with Node.js, React, and WebRTC.

## ✨ Features

*   Real-time one-to-one and group messaging
*   Audio and video conferencing using WebRTC
*   User authentication and management
*   Admin panel for user administration
*   File and image sharing

## 🛠️ Tech Stack

*   **Backend**: Node.js, Express, Socket.IO, Mediasoup
*   **Frontend**: React (with Vite), Redux, SASS
*   **Database**: MongoDB (with Mongoose)

## 🚀 Getting Started

Follow these instructions to get a copy of the project up and running on your local machine for development and testing purposes.

### Prerequisites

*   **Node.js**: Version `18.x.x` is required. We recommend using a version manager like nvm or nvm-windows.
*   **npm**: Comes bundled with Node.js.
*   **MongoDB**: A running instance of MongoDB. You can use a local installation or a cloud service like MongoDB Atlas.

### Installation

1.  **Clone the repository**
    ```bash
    git clone <your-repository-url>
    cd <repository-folder>
    ```

2.  **Set up the Node.js version**
    If you are using `nvm`, run the following command in the project root:
    ```bash
    nvm use 18
    ```

3.  **Configure Environment Variables**

    You need to create `.env` files for both the backend and the frontend.

    *   **Backend**: Copy `backend/.env.example` to `backend/.env` and fill in the required values, especially your `MONGO_URI`.

        ```bash
        # In the /backend directory
        copy .env.example .env
        ```

    *   **Frontend**: Copy `frontend/.env.example` to `frontend/.env` and ensure `VITE_BACKEND_URL` points to your local backend server (e.g., `http://localhost:4002`).

        ```bash
        # In the /frontend directory
        copy .env.example .env
        ```

4.  **Install Dependencies**

    Install the dependencies for both the backend and frontend.

    *   **Backend Dependencies**:
        ```bash
        cd backend
        npm install
        ```

    *   **Frontend Dependencies**:
        ```bash
        cd frontend
        npm install
        ```

### Running the Application

You will need to run the backend and frontend servers in two separate terminals.

1.  **Start the Backend Server**

    ```bash
    # In the /backend directory
    npm start
    ```
    The backend will be running on the port specified in your `backend/.env` file (e.g., `http://localhost:4002`).

2.  **Start the Frontend Development Server**

    ```bash
    # In the /frontend directory
    npm run dev
    ```
    The frontend will be available at the URL provided by Vite (usually `http://localhost:5173`).

## 部署

This application is ready to be deployed on platforms like Render, Vercel, or Heroku. Remember to configure the environment variables in your hosting provider's dashboard.
