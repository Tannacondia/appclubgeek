# Club Geek

Aplicación web en español para gestionar una comunidad de videojuegos y juegos de mesa. Incluye cuentas de socios y administración, catálogo, torneos, reservas, préstamos, devoluciones y resumen personal.

## Tecnologías

- React 19, TypeScript y Vite.
- Supabase Auth para registro/inicio de sesión y PostgreSQL para los datos persistentes.
- Row Level Security (RLS) y funciones SQL para proteger las operaciones sensibles en el servidor.
- Sesión del navegador guardada en `sessionStorage`; las contraseñas no se guardan en el cliente.

## Requisitos

- Node.js 20 o posterior y npm.
- Un proyecto Supabase.

## Instalación local

1. Instalá las dependencias:

   ```sh
   npm install
   ```

2. Copiá `.env.example` a `.env` y completá la URL del proyecto y la clave pública **anon/publishable**. No uses la `service_role` en el frontend.

   ```env
   VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
   VITE_SUPABASE_ANON_KEY=tu-clave-publica-anon
   ```

3. En Supabase, abrí **SQL Editor**, ejecutá el contenido de `supabase/schema.sql` y verificá que las tablas y políticas se hayan creado.
4. Ejecutá también `supabase/game-images.sql` para agregar la columna de imágenes, crear el bucket `game-images` y configurar sus permisos.
5. En la configuración de Auth, elegí si vas a requerir confirmación de correo y configurá las URL de redirección para desarrollo y producción.
6. Iniciá la aplicación:

   ```sh
   npm run dev
   ```

   Vite muestra la dirección local en la terminal.

## Crear la primera cuenta administradora

1. Registrá una cuenta desde la pantalla pública; el registro solo crea socios.
2. Confirmá el correo si la confirmación está activada.
3. En Supabase Auth, copiá el UUID de esa cuenta.
4. En SQL Editor ejecutá, reemplazando el UUID:

   ```sql
   update public.user_roles
   set role = 'admin'
   where user_id = 'UUID-DE-LA-CUENTA';
   ```

La tabla de roles no permite escritura desde el cliente. No guardes secretos de administración ni claves `service_role` en Git o en variables `VITE_*`.

## Datos y permisos

El esquema está en `supabase/schema.sql`; `supabase/game-images.sql` configura el bucket `game-images`, la columna de imagen y las políticas de Storage. Crea perfiles, roles, juegos, torneos, inscripciones, reservas y préstamos. La creación de cada usuario genera un perfil y asigna el rol `member`; el servidor valida cupos, disponibilidad, solapamientos y autorización administrativa. Los perfiles y actividades personales solo son visibles para su titular y los administradores autorizados mediante RLS. Solo los administradores pueden subir o reemplazar imágenes; se aceptan JPG, PNG y WebP de hasta 5 MB.

Usá un proyecto Supabase separado para desarrollo y producción. No desactives RLS. Si modificás las tablas o políticas, revisá los permisos desde una cuenta de socio y otra administradora.

## Pruebas y comprobaciones

```sh
npm run build
npm test
```

La aplicación requiere un proyecto Supabase configurado para comprobar los flujos integrados. Después de cargar el esquema, recorré esta lista con una cuenta de prueba:

- Registrar un socio; intentar repetir DNI y correo; usar contraseñas distintas; iniciar sesión con contraseña correcta e incorrecta.
- Comprobar que un socio no pueda leer la lista de socios, modificar roles, gestionar catálogo ni usar operaciones administrativas.
- Desde una cuenta administradora, crear, consultar y eliminar un juego; abrir y cerrar un torneo; activar y desactivar un socio.
- Como socio, reservar un juego, solicitar un préstamo, inscribirse a un torneo y consultar el resumen.
- Registrar la devolución como administrador, cerrar sesión y recargar la página; verificar que los datos persisten.

Las operaciones integradas requieren las claves de un proyecto real y no se pueden validar sin ellas. El SQL incluye las restricciones que rechazan DNI/correo duplicados, cupos completos, reservas solapadas y préstamos sin disponibilidad.

## Despliegue

1. Compilá con `npm run build` y publicá el directorio `dist` en un host estático compatible con Vite, como Vercel o Netlify.
2. Configurá `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` como variables de entorno del despliegue y volvé a compilar.
3. Agregá el dominio desplegado a las URL permitidas de Supabase Auth.
4. Ejecutá `supabase/schema.sql` y `supabase/game-images.sql` en el proyecto de producción y promovué la cuenta administradora desde SQL Editor.
5. Probá acceso de socio y administrador en el dominio publicado.

## Estado del MVP

El flujo de autenticación, administración, catálogo, torneos, inscripciones, reservas, préstamos y resumen está implementado. La reserva propone el próximo bloque de dos horas y el préstamo se registra por siete días. Las pantallas de administración permiten cerrar/abrir torneos, activar/desactivar socios y registrar devoluciones. El proyecto no incluye todavía recuperación de contraseña, edición de datos de perfil ni administración granular de períodos y duración de reservas.
