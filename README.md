# Buzzer Live — React + Supabase + Vercel

Aplicación web responsive con dos modos: participante y administrador. Incluye botón rojo con sonido generado localmente, partidas por código, rondas administradas, orden de pulsación asignado en PostgreSQL y actualizaciones por Supabase Realtime Broadcast (con polling de respaldo cada 5 segundos).

> **Importante:** este repositorio es una primera versión funcional de referencia. Para usarlo en producción debes conectar tu proyecto Supabase, ejecutar el SQL y crear/autorizar la cuenta administradora. No hay credenciales reales incluidas.

## Requisitos

- Node.js 20 o superior recomendado
- Cuenta de Supabase
- Cuenta de Vercel (opcional para publicar)

## 1. Instalar y ejecutar

```bash
npm install
cp .env.example .env
npm run dev
```

En Windows PowerShell, si `cp` no funciona:

```powershell
Copy-Item .env.example .env
```

Edita `.env` con los datos de **Supabase Project Settings → API**:

```env
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_ANON_KEY=TU_CLAVE_PUBLICABLE_O_ANON
```

Usa únicamente la clave publicable/anon en el navegador. **Nunca** incluyas `service_role` en variables `VITE_*` ni en el frontend.

## 2. Configurar la base de datos

1. Crea un proyecto en Supabase.
2. Abre **SQL Editor → New query**.
3. Copia y ejecuta todo el archivo `supabase/schema.sql`.
4. En Supabase, abre **Authentication → Users → Add user** y crea el usuario administrador con correo y contraseña. Desactiva el registro público de usuarios si no lo necesitas.
5. Copia el UUID del usuario recién creado y ejecuta en SQL Editor:

```sql
insert into public.admin_users(user_id)
values ('PEGA-AQUI-EL-UUID-DEL-USUARIO-ADMIN');
```

La cuenta puede iniciar sesión, pero solo los usuarios presentes en `public.admin_users` tienen permisos administrativos. No es suficiente con crear un usuario en Auth.

## 3. Probar el flujo

1. Ejecuta `npm run dev` y abre la URL local.
2. Entra a **Acceso administrador** e inicia sesión.
3. Crea una partida y copia el código generado.
4. Abre otra ventana, otro navegador o un celular y entra a **Entrar a una partida**.
5. Introduce el código y un nombre. Repite con varios participantes.
6. Desde el administrador, inicia la ronda. Los participantes podrán pulsar el botón.
7. Bloquea la ronda para impedir nuevas pulsaciones o inicia una nueva ronda cuando corresponda.

## 4. Publicar en Vercel

1. Sube esta carpeta a un repositorio Git (GitHub, GitLab o Bitbucket).
2. En Vercel selecciona **Add New → Project** e importa el repositorio.
3. Añade `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` en Environment Variables.
4. Despliega. Vercel detectará Vite automáticamente; el comando de build es `npm run build` y el directorio de salida `dist`.
5. Para cambios posteriores, haz push al repositorio y Vercel volverá a desplegar.

## Decisiones técnicas y límites

- **Orden de pulsación:** `submit_buzz` bloquea la fila de la ronda activa (`FOR UPDATE`) y calcula el siguiente puesto dentro de esa sección crítica. PostgreSQL impone además `UNIQUE(round_id, position)` y `UNIQUE(round_id, participant_id)`. El servidor determina el orden de solicitudes aceptadas; no puede medir de forma perfecta el instante físico del toque en redes con latencias distintas.
- **Autenticación de participantes:** los participantes usan un UUID y un token aleatorio generado en el navegador. La base de datos guarda únicamente el hash SHA-256 del token. No se guarda en localStorage en esta primera versión; si se recarga la página, vuelve a entrar con un nombre distinto o limpia el estado, deberá volver a ingresar. El nombre debe ser único por sala.
- **Sonido:** Web Audio API genera el sonido en el dispositivo que presiona. No se emite audio a los demás usuarios. Algunos navegadores requieren interacción del usuario para permitir audio; aquí el sonido se invoca dentro del clic.
- **Tiempo real:** triggers de PostgreSQL emiten eventos Broadcast al tema público `room:<CÓDIGO>`. El código de partida funciona como identificador compartido, no como mecanismo fuerte de privacidad. Quien conozca el código puede consultar el estado y clasificación. No uses datos personales sensibles.
- **Anti-trampas:** es adecuado para juegos casuales. El nombre de usuario no verifica la identidad y el orden depende de las solicitudes que recibe y serializa el servidor. Para concursos de alto impacto harían falta controles adicionales.
- **Nueva ronda:** conserva el historial en la base de datos, pero el tablero muestra las pulsaciones de la ronda más reciente.

## Estructura

```text
buzzer-web/
├── src/
│   ├── lib/supabase.ts
│   ├── App.tsx
│   ├── main.tsx
│   └── styles.css
├── supabase/schema.sql
├── .env.example
├── index.html
└── README.md
```
