{-# LANGUAGE OverloadedStrings #-}
module Main where
import Web.Scotty
import Data.Aeson
import qualified Data.Aeson.KeyMap as KM
import qualified Data.Aeson.Key as K
import qualified Data.Text as T
import qualified Data.Vector as V

-- normalise keys: trim, lowercase, spaces/dashes -> underscores
norm :: Key -> Key
norm = K.fromText . T.map (\c -> if c == ' ' || c == '-' then '_' else c) . T.toLower . T.strip . K.toText

-- keep only non-empty objects; drop null / empty-string fields
clean :: Value -> Maybe Value
clean (Object o) =
  let o' = KM.fromList [ (norm k, v) | (k, v) <- KM.toList o, v /= Null, v /= String "" ]
  in if KM.null o' then Nothing else Just (Object o')
clean _ = Nothing

main :: IO ()
main = scotty 8080 $ do
  get "/health" $ text "ok"
  post "/validate" $ do
    b <- jsonData :: ActionM Value
    let rs = case b of
               Object o | Just (Array a) <- KM.lookup "records" o -> V.toList a
               _ -> []
        ok = [x | Just x <- map clean rs]
    json $ object ["ok" .= ok, "rejected" .= (length rs - length ok)]
