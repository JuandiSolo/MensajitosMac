#!/usr/bin/env bash
# Pruebas de verificación Supabase (F1)
# Requiere: SUPABASE_URL, SUPABASE_ANON_KEY, RECEIVER_SECRET en entorno

set -euo pipefail

SUPABASE_URL="${SUPABASE_URL:-https://suupgfhcozmytarrjnhd.supabase.co}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-sb_publishable_JFkuNAkyUv9ZiiNr4qBDug_pmltoU-4}"
RECEIVER_SECRET="${RECEIVER_SECRET:-8MnVwyYuoX5rCJi03Q9CIxD4sM+7zqeshKLg6IURU/A=}"
DEVICE_ID="juan-macbook"

echo "=== Pruebas Supabase F1 ==="
echo "URL: $SUPABASE_URL"
echo ""

# Helper para headers comunes
auth_headers=(-H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY")

# Helper para separar body y status code
parse_response() {
  local response="$1"
  HTTP_CODE=$(echo "$response" | tail -1)
  BODY=$(echo "$response" | sed '$d')
}

# 1. anon INSERT → OK (con Prefer: return=minimal)
echo "1. Test INSERT anon (con Prefer: return=minimal)..."
INSERT_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$SUPABASE_URL/rest/v1/messages" \
  "${auth_headers[@]}" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=minimal" \
  -d '{"device_id":"'"$DEVICE_ID"'","text":"test insert from script"}')
parse_response "$INSERT_RESPONSE"
if [[ "$HTTP_CODE" == "201" ]]; then
  echo "   ✅ INSERT OK (201)"
else
  echo "   ❌ INSERT FAIL ($HTTP_CODE): $BODY"
  exit 1
fi

# Obtener el ID del mensaje insertado para siguientes tests
MSG_ID=$(curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/pull_messages" \
  "${auth_headers[@]}" \
  -H "Content-Type: application/json" \
  -d '{"p_secret":"'"$RECEIVER_SECRET"'","p_device":"'"$DEVICE_ID"'","p_limit":1}' | jq -r '.[0].id // empty')

if [[ -z "$MSG_ID" ]]; then
  echo "   ⚠️ No se pudo obtener ID del mensaje de prueba"
else
  echo "   Mensaje de prueba ID: $MSG_ID"
fi

# 2. anon SELECT en messages → DENEGADO
echo ""
echo "2. Test SELECT anon en messages (debe fallar)..."
SELECT_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$SUPABASE_URL/rest/v1/messages?select=id" \
  "${auth_headers[@]}")
HTTP_CODE=$(echo "$SELECT_RESPONSE" | tail -1)
if [[ "$HTTP_CODE" == "401" || "$HTTP_CODE" == "403" ]]; then
  echo "   ✅ SELECT denegado correctamente ($HTTP_CODE)"
else
  echo "   ❌ SELECT debería estar denegado ($HTTP_CODE)"
  exit 1
fi

# 3. anon UPDATE en messages → DENEGADO
echo ""
echo "3. Test UPDATE anon en messages (debe fallar)..."
UPDATE_RESPONSE=$(curl -s -w "\n%{http_code}" -X PATCH "$SUPABASE_URL/rest/v1/messages?id=eq.$MSG_ID" \
  "${auth_headers[@]}" \
  -H "Content-Type: application/json" \
  -d '{"text":"hack"}')
HTTP_CODE=$(echo "$UPDATE_RESPONSE" | tail -1)
if [[ "$HTTP_CODE" == "401" || "$HTTP_CODE" == "403" ]]; then
  echo "   ✅ UPDATE denegado correctamente ($HTTP_CODE)"
else
  echo "   ❌ UPDATE debería estar denegado ($HTTP_CODE)"
  exit 1
fi

# 4. anon DELETE en messages → DENEGADO
echo ""
echo "4. Test DELETE anon en messages (debe fallar)..."
DELETE_RESPONSE=$(curl -s -w "\n%{http_code}" -X DELETE "$SUPABASE_URL/rest/v1/messages?id=eq.$MSG_ID" \
  "${auth_headers[@]}")
HTTP_CODE=$(echo "$DELETE_RESPONSE" | tail -1)
if [[ "$HTTP_CODE" == "401" || "$HTTP_CODE" == "403" ]]; then
  echo "   ✅ DELETE denegado correctamente ($HTTP_CODE)"
else
  echo "   ❌ DELETE debería estar denegado ($HTTP_CODE)"
  exit 1
fi

# 5. pull_messages con secreto malo → ERROR
echo ""
echo "5. Test pull_messages con secreto malo (debe fallar)..."
BAD_SECRET_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$SUPABASE_URL/rest/v1/rpc/pull_messages" \
  "${auth_headers[@]}" \
  -H "Content-Type: application/json" \
  -d '{"p_secret":"secret_incorrecto","p_device":"'"$DEVICE_ID"'","p_limit":10}')
HTTP_CODE=$(echo "$BAD_SECRET_RESPONSE" | tail -1)
parse_response "$BAD_SECRET_RESPONSE"
if [[ "$HTTP_CODE" == "400" || "$HTTP_CODE" == "401" ]] && echo "$BODY" | grep -q "Invalid receiver secret"; then
  echo "   ✅ Secreto malo rechazado ($HTTP_CODE)"
else
  echo "   ❌ Debería fallar con 'Invalid receiver secret' ($HTTP_CODE): $BODY"
  exit 1
fi

# 6. pull_messages con secreto bueno → devuelve mensaje
echo ""
echo "6. Test pull_messages con secreto bueno..."
GOOD_SECRET_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$SUPABASE_URL/rest/v1/rpc/pull_messages" \
  "${auth_headers[@]}" \
  -H "Content-Type: application/json" \
  -d '{"p_secret":"'"$RECEIVER_SECRET"'","p_device":"'"$DEVICE_ID"'","p_limit":10}')
HTTP_CODE=$(echo "$GOOD_SECRET_RESPONSE" | tail -1)
parse_response "$GOOD_SECRET_RESPONSE"
if [[ "$HTTP_CODE" == "200" ]] && echo "$BODY" | grep -q "$MSG_ID"; then
  echo "   ✅ pull_messages OK, mensaje recibido"
else
  echo "   ❌ pull_messages falló ($HTTP_CODE): $BODY"
  exit 1
fi

# 7. ack_messages → delivered_at se llena
echo ""
echo "7. Test ack_messages..."
ACK_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$SUPABASE_URL/rest/v1/rpc/ack_messages" \
  "${auth_headers[@]}" \
  -H "Content-Type: application/json" \
  -d '{"p_secret":"'"$RECEIVER_SECRET"'","p_ids":["'"$MSG_ID"'"]}')
parse_response "$ACK_RESPONSE"
if [[ "$HTTP_CODE" == "200" ]] && [[ "$BODY" == "1" ]]; then
  echo "   ✅ ack_messages OK (1 fila actualizada)"
else
  echo "   ❌ ack_messages falló ($HTTP_CODE): $BODY"
  exit 1
fi

# 8. pull_messages después de ack → NO devuelve el mensaje
echo ""
echo "8. Test pull_messages tras ack (no debe devolver mensaje)..."
PULL_AFTER_ACK=$(curl -s -w "\n%{http_code}" -X POST "$SUPABASE_URL/rest/v1/rpc/pull_messages" \
  "${auth_headers[@]}" \
  -H "Content-Type: application/json" \
  -d '{"p_secret":"'"$RECEIVER_SECRET"'","p_device":"'"$DEVICE_ID"'","p_limit":10}')
parse_response "$PULL_AFTER_ACK"
if [[ "$HTTP_CODE" == "200" ]] && [[ "$BODY" == "[]" ]]; then
  echo "   ✅ Mensaje ya no aparece tras ack (array vacío)"
else
  echo "   ❌ Debería devolver array vacío ($HTTP_CODE): $BODY"
  exit 1
fi

# 9. Subir imagen como anon → OK
echo ""
echo "9. Test upload imagen a Storage (anon)..."
# Crear una imagen de prueba 1x1 pixel PNG
TEST_IMG=$(base64 -d <<< "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")
IMG_NAME="test-$(date +%s).png"
UPLOAD_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$SUPABASE_URL/storage/v1/object/media/$IMG_NAME" \
  "${auth_headers[@]}" \
  -H "Content-Type: image/png" \
  --data-binary @- <<< "$TEST_IMG")
parse_response "$UPLOAD_RESPONSE"
if [[ "$HTTP_CODE" == "200" ]] || [[ "$HTTP_CODE" == "201" ]]; then
  echo "   ✅ Upload imagen OK ($HTTP_CODE)"
  IMG_PATH="$IMG_NAME"
else
  echo "   ❌ Upload imagen falló ($HTTP_CODE): $BODY"
  exit 1
fi

# 10. Listar bucket como anon → DENEGADO (o 404 si endpoint no expone list)
echo ""
echo "10. Test list bucket media (anon, debe fallar o 404)..."
LIST_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$SUPABASE_URL/storage/v1/object/list/media" \
  "${auth_headers[@]}")
HTTP_CODE=$(echo "$LIST_RESPONSE" | tail -1)
# Aceptar 400, 401, 403 o 404 (el bucket existe pero el endpoint list puede dar 400/404 en algunos setups)
if [[ "$HTTP_CODE" == "400" || "$HTTP_CODE" == "401" || "$HTTP_CODE" == "403" || "$HTTP_CODE" == "404" ]]; then
  echo "   ✅ List denegado/no accesible correctamente ($HTTP_CODE)"
else
  echo "   ❌ List debería estar denegado ($HTTP_CODE)"
  exit 1
fi

# 11. Borrar archivo como anon → DENEGADO (o 400/404 si endpoint no expone delete)
echo ""
echo "11. Test delete file storage (anon, debe fallar)..."
DEL_IMG_RESPONSE=$(curl -s -w "\n%{http_code}" -X DELETE "$SUPABASE_URL/storage/v1/object/media/$IMG_NAME" \
  "${auth_headers[@]}")
HTTP_CODE=$(echo "$DEL_IMG_RESPONSE" | tail -1)
if [[ "$HTTP_CODE" == "400" || "$HTTP_CODE" == "401" || "$HTTP_CODE" == "403" || "$HTTP_CODE" == "404" ]]; then
  echo "   ✅ Delete denegado/no accesible correctamente ($HTTP_CODE)"
else
  echo "   ❌ Delete debería estar denegado ($HTTP_CODE)"
  exit 1
fi

# Limpiar archivo de prueba (usando service_role no disponible aquí, quedará en bucket)
echo ""
echo "=== TODAS LAS PRUEBAS F1 PASARON ✅ ==="
echo "Nota: archivo de prueba $IMG_NAME quedó en bucket (limpieza manual o via cleanup function)"