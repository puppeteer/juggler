set -e

if [ -e ./mach ]; then
  echo Checking Juggler root - OK
else
  echo Please run this script from the Juggler root
  exit 1;
fi
cd obj-x86_64-apple-darwin17.7.0/dist/
zip -r firefox-mac.zip firefox
mv firefox-mac.zip ../../../
cd -
gsutil mv firefox-mac.zip gs://juggler-builds/$(git rev-parse HEAD)/
