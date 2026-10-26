# Encuestas FIGARÓ

El sitio estático de GitHub Pages no guarda contraseñas ni respuestas. Esta sección utiliza Supabase para autenticar a la persona administradora y almacenar las encuestas y sus respuestas con Row Level Security (RLS).

## Preparación única

1. La URL pública de FIGARÓ está definida en `config.js` como `https://ccfigaro.github.io/figaro/`; los enlaces compartidos apuntarán allí. Crea un proyecto en Supabase y copia su **Project URL** y la clave pública **anon/publishable** en ese archivo. Nunca incluyas una clave `service_role` en este sitio.
2. En Supabase, abre **Authentication → Providers / Sign-in** y desactiva el registro público. Crea una sola cuenta administradora desde el panel de Supabase.
3. Ejecuta `supabase-schema.sql` en el SQL Editor. Copia el **User UID** de la cuenta administradora desde Authentication y sustituye el UUID de ejemplo del `INSERT` comentado al final del SQL; luego ejecuta ese `INSERT`.
4. En **Authentication → URL Configuration**, agrega `https://ccfigaro.github.io` a **Site URL** y a la lista de URLs permitidas.
5. Publica los archivos del repositorio en GitHub Pages. La administración estará en `/figaro/encuestas/`; cada formulario público tendrá su propio enlace `/figaro/encuestas/responder.html?id=...`.

## Uso

- Inicia sesión en el panel y crea o edita la encuesta. Solo una encuesta publicada puede abrirse con el enlace público.
- Comparte el enlace del formulario. La página pública no muestra el panel, las demás encuestas ni los resultados.
- En **Respuestas / exportar**, descarga el paquete **JSON para Mirador** para conservar tipos, opciones y respuestas. También puedes descargar un CSV para una hoja de cálculo.
- En Mirador, abre **Encuestas → Importar paquete web** y elige el JSON. La app local crea o actualiza el instrumento y deja sus resultados listos para el análisis.

## Privacidad y límites

- El SQL no concede lectura directa de la tabla de encuestas ni de las respuestas al público. Un enlace aleatorio permite consultar solamente su formulario publicado; la lectura, edición y exportación de respuestas requiere el UID de la cuenta autorizada.
- Cuando ya se recibe la primera respuesta, el cuestionario queda protegido contra cambios en sus preguntas para conservar la correspondencia entre preguntas y datos; crea otra encuesta si necesitas un instrumento diferente.
- El formulario público solo envía las respuestas y la aceptación del consentimiento. No recoge nombre, edad ni IP.
- Antes de recolectar datos sensibles o de menores, define aviso, consentimiento, retención y eliminación adecuados a tu investigación.
- Los formularios públicos aceptan envíos anónimos; un endpoint público puede recibir spam. Para investigaciones de alto riesgo o grandes volúmenes, añade una verificación anti-bots y límites de envío antes de difundir el enlace.
- La clave anon/publishable es visible en el navegador por diseño; la seguridad depende de RLS. No publiques la clave `service_role`.
- Crear una cuenta/proyecto y ejecutar el SQL en Supabase son pasos manuales; después de eso, crear y publicar nuevas encuestas no requiere modificar ni volver a subir código.
