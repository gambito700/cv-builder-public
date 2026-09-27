"""Servidor estatico de desarrollo para apps/web, SIN CACHE.

Por que existe: `python -m http.server` no manda cabeceras Cache-Control, asi
que el navegador aplica cache heuristica basada en Last-Modified y se queda con
el CSS viejo aunque el archivo cambie en disco. Con este servidor cada peticion
revalida siempre.

Por que es multi-hilo: con socketserver.TCPServer (un solo hilo) el navegador
aburre conexiones ADELANTADAS sin mandar nada. La primera de esas conexiones
especulativas bloquea el unico hilo del servidor en readline() y TODAS las
peticiones reales quedan en la cola sin aceptarse: la pagina se queda en blanco
y curl devuelve HTTP 000 aunque el puerto este escuchando. ThreadingHTTPServer
atiende cada conexion en su propio hilo, y daemon_threads evita que un cliente
abandonado bloquee el apagado.

Uso:  python dev-server.py [puerto]
"""
import functools
import http.server
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
PUERTO = int(sys.argv[1]) if len(sys.argv) > 1 else 8080


class SinCache(http.server.SimpleHTTPRequestHandler):
    # HTTP/1.1 para que el navegador reutilice la conexion. Sin esto el
    # servidor cierra cada respuesta y el navegador abre 6 conexiones en
    # paralelo, lo que con un solo hilo vuelve a colgarlo.
    protocol_version = "HTTP/1.1"

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        # El handler declara Content-Length, asi que keep-alive es seguro.
        super().end_headers()

    def log_message(self, formato, *args):
        # Log a stderr: stdout suele estar redirigido a un archivo y llenarse.
        try:
            sys.stderr.write("%s - %s\n" % (self.address_string(), formato % args))
            sys.stderr.flush()
        except Exception:
            pass


if __name__ == "__main__":
    manejador = functools.partial(SinCache, directory=str(RAIZ))
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    http.server.ThreadingHTTPServer.daemon_threads = True
    with http.server.ThreadingHTTPServer(("127.0.0.1", PUERTO), manejador) as httpd:
        print(f"CV Builder dev server (sin cache) en http://localhost:{PUERTO}", flush=True)
        print(f"Sirviendo: {RAIZ}", flush=True)
        httpd.serve_forever()