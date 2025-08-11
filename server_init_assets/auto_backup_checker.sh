cd /opt/minecloud/

./send_discord_message_to_webhook.sh "Starting scheduled backup check..."
backUpTimeFilePath=lastBackupTime.txt
if [ ! -f "$backUpTimeFilePath" ]; 
    then
        echo "$backUpTimeFilePath does not exist, creating initial backup"
        ./send_discord_message_to_webhook.sh "No previous backup found. Creating initial backup..."
        ./server_backup.sh
        currentTime=$(date +%s)
        echo "$currentTime" > lastBackupTime.txt
    else
        lastBackupTime=`cat lastBackupTime.txt`
        echo "lastBackupTime: $lastBackupTime"

        currentTime=$(date +%s)
        echo "currentTime: $currentTime"

        backUpInterval=${BACKUP_INTERVAL:=10800}
        echo "backUpInterval: $backUpInterval"

        timeSinceLastBackup=$(($currentTime - $lastBackupTime))
        echo "timeSinceLastBackup: $timeSinceLastBackup"

        if (($timeSinceLastBackup > $backUpInterval));
        then
            ./send_discord_message_to_webhook.sh "Backup needed: $(($timeSinceLastBackup/60)) minutes since last backup. Creating new backup..."
            ./server_backup.sh
            currentTime=$(date +%s)
            echo "$currentTime" > lastBackupTime.txt
        else
            nextBackupIn=$(($backUpInterval - $timeSinceLastBackup))
            ./send_discord_message_to_webhook.sh "Backup check complete: Last backup was $(($timeSinceLastBackup/60)) minutes ago. Next scheduled backup in $(($nextBackupIn/60)) minutes."
        fi;
fi