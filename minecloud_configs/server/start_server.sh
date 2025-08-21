#!/bin/sh

echo "Starting Minecraft server"
# You can adjust your server start up command here
/usr/bin/env sudo java -Xmx3584M -Xms1024M -XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:+AlwaysPreTouch -jar fabric-server-loader.jar nogui
echo "Minecraft server stop"