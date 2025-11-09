# Mokuro Library

Mokuro Library is a self-hosted, multi-user web application designed to run on a NAS or home server. It provides a web-based reader for manga processed with [Mokuro](https://github.com/kha-white/mokuro), solving browser storage limitations by keeping all library files, metadata, and user progress on the server.



## 🌟 Core Features

For more details, read [the specification](docs/specification.md):
* **Multi-User Authentication:** Separate accounts for different users, with progress and settings saved per-user.
* **Server-Side Library:** Upload entire Mokuro-processed directories. All files are managed by the server.
* **Persistent, Per-User Progress:** Reading progress, page, and completion status are saved to the database for each user.
* **Persistent Reader Settings:** All reader preferences (layout, direction, etc.) are saved to your account.
* **Live OCR Editing:** Edit and correct OCR text blocks directly in the reader UI. Changes are saved back to the `.mokuro` file on the server.
* **Dockerized Deployment:** A single Docker container runs the entire application, making setup and maintenance simple.
* **Volume & Series Management:** Upload series covers, delete individual volumes, or remove entire series from your library.

## 💻 Technology Stack

This project is a monorepo containing a decoupled frontend and backend.

* **Backend:** **Node.js** with **Fastify** for high-performance routing.
* **Frontend:** **SvelteKit** with **TypeScript** and **Tailwind CSS**.
* **Database:** **SQLite** for simple, file-based data persistence.
* **ORM:** **Prisma** for type-safe database access and migrations.
* **Containerization:** **Docker** and **Docker Compose**.

## 🚀 Deployment (Production)

The recommended way to run Mokuro Library is with Docker Compose.

1.  **Build the Image:**
    This command builds the production-ready Docker image, compiling both the frontend and backend.
    ```bash
    docker compose build --no-cache
    ```

2.  **Run the Container:**
    This starts the container in detached mode.
    ```bash
    docker compose up -d
    ```
    Your library is now accessible at `http://localhost`. The following local folders will be created to store your persistent data:
    * `./data`: Stores your `library.db` database file.
    * `./data/uploads`: Stores all uploaded manga files.

### Updating the Application

When you pull new changes from Git or modify the schema:

1.  **Re-build the image:**
    ```bash
    docker compose build
    ```
2.  **Re-create the container:**
    The `--force-recreate` flag is necessary to apply the new image. The entrypoint script will automatically run any database migrations.
    ```bash
    docker compose up -d --force-recreate
    ```
    Your data in the `./data` folder will be preserved.

## 🛠️ Development (with Hot-Reload)

This project is configured for a full-stack, containerized development environment using a `docker-compose.dev.yml` override file. This setup runs both the backend and frontend in separate, hot-reloading containers, which is the recommended workflow.

### How It Works

The `docker compose -f docker-compose.yml -f docker-compose.dev.yml ...` command merges two files:
1.  `docker-compose.yml`: Provides the base configuration (like service names and data volumes).
2.  `docker-compose.dev.yml`: Overrides and adds services for development:
    * **`mokuro` (Backend):** The `mokuro` service is overridden to target the `backend-builder` stage, mount local `./backend` folder, and run the `npm run dev` script. `ts-node-dev` watches your `src` files and restarts the Node.js server on changes.
    * **`frontend` (Frontend):** A new `frontend` service is added. It targets the `frontend-builder` stage, mounts local `./frontend` folder, and runs the Vite dev server (`npm run dev -- --host`).

### Running the Dev Environment

1.  **First-Time Build (or when `package.json` changes):**
    You must build the dev images once to install all dependencies (including `devDependencies`).
    ```bash
    docker compose -f docker-compose.yml -f docker-compose.dev.yml build
    ```

2.  **Start the Dev Environment:**
    This command starts both the backend and frontend services.
    ```bash
    docker compose -f docker-compose.yml -f docker-compose.dev.yml up
    ```

3.  **Access the app:**
    * Open `http://localhost:5173` in your browser.
    * The SvelteKit app will load and automatically proxy all `/api` requests to the `mokuro` backend container, thanks to the `VITE_PROXY_TARGET` environment variable.

---

### Development Workflow

Once the containers are running.

#### Changing `backend/src` or `frontend/src` Code
This is the most common case.
* **Backend:** Save a file in `backend/src`. The `mokuro` container's log will show `ts-node-dev` restarting the server.
* **Frontend:** Save a file in `frontend/src`. Your browser will instantly hot-reload with the changes.

#### Changing `package.json` (Adding a Package)
This requires a **rebuild** to install the new dependencies in the image's `node_modules` layer.
1.  Stop the server (`Ctrl+C`).
2.  Run the `build` command:
    ```bash
    docker compose -f docker-compose.yml -f docker-compose.dev.yml build
    ```
3.  Restart the server:
    ```bash
    docker compose -f docker-compose.yml -f docker-compose.dev.yml up
    ```

#### Changing `backend/prisma/schema.prisma` (Database Schema)
This requires a **restart** to run the migration, plus a manual client generation.
1.  Stop the server (`Ctrl+C`).
2.  **Run `prisma generate` on your host machine.** This is necessary to update your local `backend/src/generated/prisma` folder, which is mounted into the container.
    ```bash
    (cd backend && npx prisma generate)
    ```
3.  **Restart the server:**
    ```bash
    docker compose -f docker-compose.yml -f docker-compose.dev.yml up
    ```
    On startup, the `mokuro` service's `npm run dev` script automatically executes `npx prisma db push`, which reads your mounted `schema.prisma` file and updates your persistent database in `./data`.

---

### Alternate: Hybrid Development (Frontend on Host)

If you prefer to run the frontend on your host machine (for faster hot-reloading), you can. The `vite.config.ts` file is designed to support this.

1.  **Start the Backend Only:**
    Use the *production* compose file. It will run the backend and handle API requests.
    ```bash
    docker compose up
    ```
2.  **Run Frontend on Host:**
    In a separate terminal, run the SvelteKit dev server on your host machine.
    ```bash
    cd frontend
    npm install
    npm run dev
    ```
3.  **Access Your App:**
    * Open `http://localhost:5173` in your browser.
    * Your `vite.config.ts` will not find the `VITE_PROXY_TARGET` environment variable, so it will correctly default to proxying API requests to `http://localhost:3001` (the port exposed by your backend container).
