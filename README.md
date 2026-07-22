# Binti Events API Backend

Standalone Node.js/Express REST API service for Binti Events Quote & Invoice Management System.

---

## 🛠️ Local Development

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Development Server
```bash
npm run dev
```
The server will run on `http://localhost:3000`.

### 3. Build & Test Production Bundle
```bash
npm run build
npm start
```

---

## 🚀 Hosting on Render (Step-by-Step)

You can host this backend as an independent **Web Service** on [Render](https://render.com).

### Option A: Automatic Setup using `render.yaml` Blueprint

1. Push the `backend` folder (or separate Git repository) to GitHub / GitLab.
2. Log in to [Render Dashboard](https://dashboard.render.com/).
3. Click **New +** -> **Blueprint**.
4. Connect your repository. Render will automatically detect `render.yaml` and configure the Web Service.

---

### Option B: Manual Web Service Setup

1. Go to [Render Dashboard](https://dashboard.render.com/) and click **New +** -> **Web Service**.
2. Connect your Git repository (select the `backend` directory if using a monorepo).
3. Configure the following settings:

| Setting | Value |
| :--- | :--- |
| **Name** | `binti-events-backend` |
| **Environment** | `Node` |
| **Region** | Choose nearest (e.g. Frankfurt, Oregon) |
| **Branch** | `main` (or your active branch) |
| **Root Directory** | `backend` *(leave blank if hosting from a standalone backend repo)* |
| **Build Command** | `npm install && npm run build` |
| **Start Command** | `npm start` |

4. Under **Environment Variables**, add:
   - `CORS_ORIGIN`: `*` *(or your deployed frontend URL e.g. `https://your-client.onrender.com`)*
   - `NODE_ENV`: `production`

5. (Optional - Persistent Storage):
   - Under **Disks**, add a Disk mounted at `/var/data` (e.g. Size `1 GB`).
   - Add environment variable `DATA_DIR` = `/var/data`.

6. Click **Create Web Service**.

---

## 🏥 Health Check Endpoint

Once deployed, you can verify your service status at:
- `https://<your-render-app>.onrender.com/health`
- `https://<your-render-app>.onrender.com/api/health`
