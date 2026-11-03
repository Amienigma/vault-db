import java.sql.{Connection, DriverManager}
import java.net.URI
import java.net.http.{HttpClient, HttpRequest, HttpResponse}
import java.nio.file.{Files, Path}
import scala.util.Try

object Worker {
  val http = HttpClient.newHttpClient()

  def connect(): Connection = {
    var c: Option[Connection] = None
    while (c.isEmpty) {
      c = Try(DriverManager.getConnection(sys.env("JDBC_URL"), sys.env("PGUSER"), sys.env("PGPASSWORD"))).toOption
      if (c.isEmpty) Thread.sleep(2000)
    }
    c.get
  }

  def csvLine(s: String): Vector[String] = {
    val out = Vector.newBuilder[String]; val sb = new StringBuilder; var q = false; var i = 0
    while (i < s.length) {
      val c = s(i)
      if (q) { if (c == '"') { if (i + 1 < s.length && s(i + 1) == '"') { sb += '"'; i += 1 } else q = false } else sb += c }
      else if (c == '"') q = true
      else if (c == ',') { out += sb.result(); sb.clear() }
      else sb += c
      i += 1
    }
    out += sb.result(); out.result()
  }

  def parse(name: String, text: String): Seq[ujson.Value] = {
    val n = name.toLowerCase
    val lines = text.linesIterator.filter(_.trim.nonEmpty).toVector
    if (n.endsWith(".jsonl") || n.endsWith(".ndjson")) lines.map(l => ujson.read(l))
    else if (n.endsWith(".json")) ujson.read(text) match { case ujson.Arr(a) => a.toSeq; case o => Seq(o) }
    else {
      val h = csvLine(lines.head)
      lines.tail.map { l =>
        val o = ujson.Obj()
        h.zip(csvLine(l)).foreach { (k, v) => o(k) = ujson.Str(v) }
        o: ujson.Value
      }
    }
  }

  def setStatus(c: Connection, id: Long, st: String, ok: Int, rej: Int, err: String): Unit = {
    val p = c.prepareStatement("UPDATE files SET status=?, rows_loaded=?, rejected=?, error=? WHERE id=?")
    p.setString(1, st); p.setInt(2, ok); p.setInt(3, rej); p.setString(4, err); p.setLong(5, id); p.executeUpdate(); p.close()
  }

  def process(c: Connection): Unit = {
    val rs = c.createStatement().executeQuery("SELECT id,path,name FROM files WHERE status='pending' ORDER BY id LIMIT 1")
    if (!rs.next()) return
    val (id, path, name) = (rs.getLong(1), rs.getString(2), rs.getString(3))
    setStatus(c, id, "processing", 0, 0, null)
    try {
      val recs = parse(name, Files.readString(Path.of(path)))
      val body = ujson.write(ujson.Obj("records" -> ujson.Arr.from(recs)))
      val req = HttpRequest.newBuilder(URI.create(sys.env("GUARD_URL") + "/validate"))
        .header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(body)).build()
      val resp = ujson.read(http.send(req, HttpResponse.BodyHandlers.ofString()).body())
      val ok = resp("ok").arr
      val ps = c.prepareStatement("INSERT INTO records(file_id,data) VALUES(?, ?::jsonb)")
      ok.foreach { r => ps.setLong(1, id); ps.setString(2, ujson.write(r)); ps.addBatch() }
      ps.executeBatch(); ps.close()
      setStatus(c, id, "loaded", ok.size, resp("rejected").num.toInt, null)
    } catch { case ex: Exception => setStatus(c, id, "failed", 0, 0, ex.toString.take(300)) }
  }

  def main(args: Array[String]): Unit = {
    val c = connect()
    while (true) { process(c); Thread.sleep(2000) }
  }
}
