import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Constantes de retención (D1, D2)
const DELIVERED_RETENTION_HOURS = 12;  // D1: 12h después de delivered_at
const UNDELIVERED_RETENTION_DAYS  = 15; // D2: 15 días sin entregar

serve(async (req) => {
  // Solo permitir invocación con service_role (desde pg_cron/pg_net o GitHub Actions)
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return new Response("Unauthorized", { status: 401 });
  }
  const token = authHeader.slice(7);
  if (token !== SERVICE_ROLE_KEY) {
    return new Response("Forbidden", { status: 403 });
  }

  // Permitir override de retención para testing: ?retention_hours=0
  const url = new URL(req.url);
  const testRetentionHours = url.searchParams.get("retention_hours");
  const deliveredRetentionHours = testRetentionHours !== null
    ? parseInt(testRetentionHours, 10)
    : DELIVERED_RETENTION_HOURS;

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  });

  const now = new Date();
  const deliveredCutoff = new Date(now.getTime() - deliveredRetentionHours * 60 * 60 * 1000);
  const undeliveredCutoff = new Date(now.getTime() - UNDELIVERED_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  // 1. Seleccionar mensajes a borrar
  const { data: messages, error: selectError } = await supabase
    .from("messages")
    .select("id, image_path")
    .or(`delivered_at.lt.${deliveredCutoff.toISOString()},and(delivered_at.is.null,created_at.lt.${undeliveredCutoff.toISOString()})`);

  if (selectError) {
    console.error("Error selecting messages:", selectError);
    return new Response(JSON.stringify({ error: selectError.message }), { status: 500 });
  }

  if (!messages || messages.length === 0) {
    return new Response(JSON.stringify({ deletedMessages: 0, deletedFiles: 0 }), { status: 200 });
  }

  const imagePaths = messages
    .map(m => m.image_path)
    .filter((p): p is string => p !== null && p !== undefined);

  // 2. Borrar archivos de Storage (usar API de Storage, NO SQL directo)
  let deletedFiles = 0;
  if (imagePaths.length > 0) {
    const { error: storageError } = await supabase.storage
      .from("media")
      .remove(imagePaths);

    if (storageError) {
      console.error("Error deleting storage files:", storageError);
      // Continuar para borrar las filas de la BD aunque fallen archivos
    } else {
      deletedFiles = imagePaths.length;
    }
  }

  // 3. Borrar filas de la BD
  const ids = messages.map(m => m.id);
  const { error: deleteError } = await supabase
    .from("messages")
    .delete()
    .in("id", ids);

  if (deleteError) {
    console.error("Error deleting messages:", deleteError);
    return new Response(JSON.stringify({ error: deleteError.message }), { status: 500 });
  }

  const result = { deletedMessages: ids.length, deletedFiles };
  console.log("Cleanup result:", result);
  return new Response(JSON.stringify(result), { status: 200 });
});