#!/bin/sh

echo "Starting Minecraft server"
# You can adjust your server start up command here
/usr/bin/env sudo java -Xmx6144M -Xms1024M -jar fabric-server-loader.jar nogui
echo "Minecraft server stop"