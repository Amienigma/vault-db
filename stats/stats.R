library(DBI); library(RPostgres); library(jsonlite)

#* @get /stats
function() {
  con <- dbConnect(Postgres(), host = Sys.getenv("PGHOST"), dbname = Sys.getenv("PGDATABASE"),
                   user = Sys.getenv("PGUSER"), password = Sys.getenv("PGPASSWORD"))
  on.exit(dbDisconnect(con))
  r <- dbGetQuery(con, "SELECT data::text AS d FROM records LIMIT 50000")
  if (nrow(r) == 0) return(list(total = 0, fields = list()))
  lst <- lapply(r$d, fromJSON)
  keys <- unique(unlist(lapply(lst, names)))
  fields <- lapply(keys, function(k) {
    v <- unlist(lapply(lst, function(x) x[[k]]))
    num <- suppressWarnings(as.numeric(v))
    if (mean(!is.na(num)) > 0.9)
      list(field = k, type = "numeric", n = length(v), mean = round(mean(num, na.rm = TRUE), 3),
           min = min(num, na.rm = TRUE), max = max(num, na.rm = TRUE), sd = round(sd(num, na.rm = TRUE), 3))
    else
      list(field = k, type = "text", n = length(v), distinct = length(unique(v)),
           top = as.list(head(sort(table(v), decreasing = TRUE), 3)))
  })
  list(total = nrow(r), fields = fields)
}
