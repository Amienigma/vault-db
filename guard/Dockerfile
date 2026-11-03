FROM haskell:9.6
WORKDIR /g
COPY . .
RUN cabal update && cabal install --installdir=/out --install-method=copy --overwrite-policy=always
CMD ["/out/guard"]
