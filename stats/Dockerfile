FROM rocker/r-ver:4.4
RUN apt-get update && apt-get install -y libpq-dev libssl-dev libsodium-dev libcurl4-openssl-dev
RUN install2.r --error plumber DBI RPostgres jsonlite
WORKDIR /r
COPY stats.R .
CMD ["Rscript", "-e", "plumber::pr_run(plumber::plumb('stats.R'), host='0.0.0.0', port=8000)"]
