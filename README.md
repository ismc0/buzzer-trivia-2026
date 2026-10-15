# Buzzer Live

Aplicación web interactiva de trivia que permite a los participantes ingresar a una sala, competir por responder primero y consultar el ranking de respuestas. Diseñada para dinámicas académicas, eventos y juegos grupales en tiempo real.

**Aplicación en producción:** https://buzzer-trivia-2026.vercel.app/

## Características principales

- **Salas de juego:** permite crear o ingresar a salas mediante un código.
- **Participantes independientes:** cada participante tiene su propia identidad dentro de la sala.
- **Sistema de buzzer:** los participantes pueden presionar un botón para registrar su respuesta.
- **Control de respuestas:** registra el orden en que los participantes presionan el buzzer.
- **Ranking:** permite consultar las posiciones registradas durante las rondas.
- **Persistencia de datos:** utiliza Supabase para almacenar la información del juego.
- **Interfaz web:** desarrollada con React y Vite, con estilos personalizados.
- **Despliegue en la nube:** publicada mediante Vercel.

## Tecnologías utilizadas

| Tecnología | Uso |
|---|---|
| React | Construcción de la interfaz de usuario |
| TypeScript | Tipado estático y organización del código |
| Vite | Herramienta de desarrollo y compilación |
| Supabase | Base de datos y comunicación con el backend |
| CSS | Estilos y diseño de la interfaz |
| Vercel | Despliegue de la aplicación |
| Git y GitHub | Control de versiones y alojamiento del código |

## Requisitos previos

Antes de ejecutar el proyecto localmente, asegúrate de tener instalado:

- [Node.js](https://nodejs.org/) (versión LTS recomendada).
- npm, incluido con Node.js.
- Una cuenta de [Supabase](https://supabase.com/) con el proyecto y la base de datos configurados.

## Instalación

### 1. Clonar el repositorio

```bash
git clone https://github.com/ismc0/buzzer-trivia-2026.git
cd buzzer-trivia-2026
```

### 2. Instalar dependencias

```bash
npm install
```

### 3. Configurar las variables de entorno

Crea un archivo `.env` en la raíz del proyecto, al mismo nivel que `package.json`.

Agrega las credenciales de tu proyecto Supabase:

```env
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=tu_clave_publicable
```

Reemplaza los valores de ejemplo por los correspondientes a tu proyecto.

**Importante:** no subas el archivo `.env` a GitHub. Las variables con prefijo `VITE_` se incluyen en el código enviado al navegador, por lo que solo deben contener valores aptos para uso público. Nunca incluyas claves `service_role`, contraseñas ni otros secretos del backend.

### 4. Ejecutar en modo desarrollo

```bash
npm run dev
```

Vite mostrará una dirección local, normalmente:

```text
http://localhost:5173/
```

Abre esa dirección en el navegador para utilizar la aplicación.

## Configuración de Supabase

Buzzer Live utiliza Supabase como servicio de backend para gestionar la información de las salas y las interacciones de los participantes.

Para que la aplicación funcione correctamente, el proyecto de Supabase debe contar con:

- La tabla de salas (`rooms`).
- La tabla de participantes (`participants`).
- La tabla de rondas (`rounds`).
- La tabla de respuestas del buzzer (`buzzes`).
- Las relaciones entre las tablas y las restricciones correspondientes.
- Las funciones de base de datos utilizadas por la aplicación, incluyendo `submit_buzz` y `get_room_state`.

La estructura de la base de datos y las funciones deben estar configuradas antes de utilizar una instalación nueva. Este README no reemplaza el script SQL ni las migraciones de la base de datos.

## Compilación para producción

Para generar la versión optimizada de la aplicación:

```bash
npm run build
```

Para ejecutar una vista previa local de la compilación:

```bash
npm run preview
```

Si la compilación termina correctamente, los archivos de producción se generan en la carpeta `dist/`.

## Despliegue en Vercel

El proyecto puede desplegarse conectando el repositorio de GitHub a Vercel.

1. Ingresa a [Vercel](https://vercel.com/).
2. Importa el repositorio `ismc0/buzzer-trivia-2026`.
3. Configura las variables de entorno `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`.
4. Verifica que el comando de compilación sea `npm run build`.
5. Verifica que el directorio de salida sea `dist`.
6. Despliega la aplicación.

Cuando se publican nuevos cambios en la rama configurada, Vercel puede generar un nuevo despliegue automáticamente.

**URL de producción:** https://buzzer-trivia-2026.vercel.app/

## Estructura general del proyecto

```text
buzzer-trivia-2026/
├── public/
├── src/
│   ├── assets/
│   │   └── ding.m4a
│   ├── App.tsx
│   └── styles.css
├── .env.example
├── .gitignore
├── package.json
├── package-lock.json
├── index.html
├── tsconfig.json
└── vite.config.ts
```

La estructura puede variar según los archivos adicionales presentes en el repositorio.

## Control de versiones

Para guardar y publicar cambios:

```bash
git add .
git commit -m "Describe your changes"
git push origin main
```

Si el repositorio está conectado a Vercel, el envío de cambios a la rama de producción puede activar un nuevo despliegue.

## Seguridad y buenas prácticas

- Mantén las credenciales locales en `.env`.
- Utiliza `.env.example` únicamente como plantilla, sin credenciales reales.
- No publiques claves privadas ni secretos administrativos.
- Configura las políticas de seguridad de Supabase y los permisos de acceso a la base de datos.
- Valida las operaciones sensibles en el backend, no únicamente en la interfaz.
- Prueba los cambios localmente antes de publicarlos.

## Estado del proyecto

Buzzer Live cuenta con una versión desplegada públicamente. Su funcionamiento depende de la disponibilidad de Vercel, Supabase y de la configuración correcta de las variables de entorno y la base de datos.