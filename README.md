\# CafeFlow ☕

\### Modern Café \& Restaurant Management Platform



\*\*CafeFlow\*\* is a modular, real-time café and restaurant management platform designed to simplify daily operations, improve customer experiences, and centralize restaurant management.



The platform combines customer QR ordering, table management, kitchen operations, employee workflows, financial management, and customer loyalty into one unified system.



> \*\*Language:\*\* The application interface is Persian (Farsi) by default, with complete RTL support and Jalali calendar localization. Source code and technical documentation are written in English.



\---



\## ✨ Core Features



\### 🛍️ Customer Experience

\- Interactive QR-based digital menu.

\- Real-time order submission and tracking.

\- Product customization and extras.

\- Table-specific QR codes.

\- Promotional QR codes and discount campaigns.

\- Customer service requests.

\- Reservation support.

\- Mobile-first responsive interface.



\### 🪑 Restaurant Management

\- Real-time table management.

\- Multiple floors and configurable areas.

\- Visual drag-and-drop floor plan designer.

\- Individual table and chair positioning.

\- Table merging and transfers.

\- Table occupancy monitoring.

\- Waiter assignment and availability queue.



\### 🍳 Kitchen \& Barista Operations

\- Dedicated kitchen dashboard.

\- Dedicated barista dashboard.

\- Automatic order routing.

\- Real-time preparation updates.

\- Preparation timers.

\- Delayed order alerts.

\- Department-specific printing.



\### 💳 Cashier \& Payments

\- Cashier dashboard.

\- Order settlement.

\- Split and merged bills.

\- Cash and card payment records.

\- Card terminal requests.

\- Receipt printing.

\- Payment history.



\### 📦 Optional Business Modules



These modules are independently configurable and disabled by default.



| Module | Default |

|---|---|

| Inventory Management | OFF |

| Employee \& Shift Management | OFF |

| Financial Management | OFF |

| CRM \& Customer Loyalty | OFF |



\*\*Inventory Management\*\*

\- Ingredient management.

\- Recipe definitions.

\- Automatic stock deduction.

\- Stock alerts.

\- Waste tracking.

\- Supplier management.



\*\*Employee Management\*\*

\- Employee profiles.

\- Shift scheduling.

\- Attendance.

\- Leave management.

\- Performance reports.



\*\*Financial Management\*\*

\- Revenue and expenses.

\- Cash register management.

\- Financial transactions.

\- Cash reconciliation.

\- Profit and loss reports.



\*\*CRM \& Loyalty\*\*

\- Customer profiles.

\- Loyalty points.

\- Customer wallet.

\- Membership levels.

\- Personalized discounts.

\- Birthday rewards.



\### 🔐 Security \& Access Control

\- Role-based access control (RBAC).

\- Granular permissions.

\- Department and floor restrictions.

\- Secure authentication.

\- Multi-factor authentication support.

\- Session management.

\- Audit logs.

\- Approval workflows.

\- Backup and recovery.



\### 🔔 Notifications \& Messaging

\- Real-time notifications.

\- Browser push notifications.

\- SMS integration.

\- Order status notifications.

\- Reservation notifications.

\- Employee notifications.

\- Promotional campaigns.

\- Notification history.



\### 🖨️ Printing \& Hardware

\- Thermal receipt printing.

\- Kitchen printing.

\- Barista printing.

\- Configurable printer routing.

\- Print queues and retry handling.

\- ESC/POS-compatible printer support.

\- Payment terminal integration architecture.



\---



\## 🎨 Design \& User Experience



\- Persian-first interface.

\- Complete RTL layout.

\- Vazirmatn typography.

\- Jalali calendar.

\- Responsive design.

\- Progressive Web App (PWA).

\- Three.js 3D coffee animation.

\- Anime.js animation sequences.



\### Brand Colors



| Color | Hex |

|---|---|

| Primary | `#aa472b` |

| Secondary | `#96a09f` |



\---



\## 🛠️ Technology Stack



| Layer | Technology |

|---|---|

| Frontend | React + TypeScript |

| Build Tool | Vite |

| Styling | Tailwind CSS |

| 3D Graphics | Three.js |

| Animations | Anime.js |

| Backend | Node.js + NestJS |

| Database | PostgreSQL |

| Real-time | WebSocket / Socket.IO |

| API | REST |

| Infrastructure | Docker |

| Application Type | PWA |



\---



\## 🏗️ Architecture



CafeFlow follows a modular architecture with clearly separated application responsibilities.



```text

CafeFlow/

├── apps/

│   ├── web/                 # Customer and admin interfaces

│   └── api/                 # Backend application

│

├── packages/

│   ├── shared/              # Shared types and utilities

│   ├── ui/                  # Reusable UI components

│   └── config/              # Shared configurations

│

├── infrastructure/

│   ├── docker/

│   ├── database/

│   └── scripts/

│

├── docs/

│   ├── architecture/

│   ├── database/

│   ├── api/

│   ├── modules/

│   └── development/

│

├── tests/

│   ├── integration/

│   └── e2e/

│

└── README.md

```



\---



\## ⚙️ Getting Started



\### Requirements



\- Node.js 22 or later.

\- npm.

\- Git.

\- Docker and Docker Compose (for containerized development).

\- PostgreSQL (if running without Docker).



\### Installation



```bash

git clone https://github.com/USERNAME/CafeFlow.git

cd CafeFlow



npm install

```



Configure your environment variables using `.env.example`.



Start the frontend and backend independently during development.



```bash

\# Frontend

npm run dev --prefix apps/web



\# Backend

npm run start:dev --prefix apps/api

```



Additional setup instructions will be documented as the project develops.



\---



\## 🧩 Development Principles



CafeFlow is designed around the following principles:



\- Modular architecture.

\- Separation of concerns.

\- Secure backend authorization.

\- Database integrity.

\- Real-time communication.

\- Configurable business modules.

\- Reusable UI components.

\- Mobile-first development.

\- Testable business logic.

\- Production-oriented engineering.



Optional modules must never break the core ordering and restaurant operations when disabled.



\---



\## 🗺️ Development Roadmap



\- \[ ] Project foundation and architecture.

\- \[ ] Database design and migrations.

\- \[ ] Authentication and authorization.

\- \[ ] Persian RTL design system.

\- \[ ] Customer homepage and coffee animation.

\- \[ ] QR menu and customer ordering.

\- \[ ] Table and floor management.

\- \[ ] Visual floor plan designer.

\- \[ ] Waiter dashboard.

\- \[ ] Kitchen and barista dashboards.

\- \[ ] Cashier and payment management.

\- \[ ] Printing infrastructure.

\- \[ ] Reservation management.

\- \[ ] Discount and QR campaign management.

\- \[ ] Inventory module.

\- \[ ] Employee and shift module.

\- \[ ] Financial management module.

\- \[ ] CRM and loyalty module.

\- \[ ] Notification and messaging center.

\- \[ ] PWA implementation.

\- \[ ] Security and performance testing.

\- \[ ] Production deployment.



\---



\## 🔒 Security



Security is a core requirement.



All sensitive operations must be validated and authorized on the backend.



Financial transactions, order modifications, discounts, user permissions, and administrative actions must have appropriate access controls and audit history.



Never commit credentials, private keys, or production environment variables.



\---



\## 📚 Documentation



Technical documentation will be maintained inside the `docs/` directory.



It will cover:



\- System architecture.

\- Database schema.

\- API specifications.

\- Module dependencies.

\- Authentication and permissions.

\- Deployment.

\- Testing.

\- Backup and recovery.



\---



\## 📌 Project Status



\*\*Development status:\*\* Initial project setup and architecture planning.



CafeFlow is being developed incrementally. Features listed in the roadmap are planned capabilities and should not be considered implemented until their functionality and tests are completed.



\---



\## 📄 License



License: To be determined.



\---



\*\*CafeFlow — One platform. Every part of your café.\*\* ☕

