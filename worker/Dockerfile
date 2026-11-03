FROM sbtscala/scala-sbt:eclipse-temurin-17.0.13_11_1.10.5_3.5.2
WORKDIR /w
COPY . .
RUN sbt compile
CMD ["sbt", "run"]
