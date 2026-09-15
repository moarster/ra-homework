workspace "Телеметрия карьерной техники" "Тестовое задание" {

  
  model {
    # Люди
    mechanic = person "Механик" "Служба главного механика"
    opsEngineer = person "Инженер эксплуатации" "DevOps/SRE"

    # Внешние системы
    gateway = softwareSystem "Телематический шлюз" "На борту машины: опрос контроллера по Modbus, энергонезависимый буфер 1 ГБ, метка времени от ГНСС" "External,Устройство,С состоянием"
    ad = softwareSystem "Active Directory" "Корпоративный каталог пользователей и групп" "External"
    siem = softwareSystem "SIEM" "Корпоративная система ИБ: корреляция событий безопасности" "External,ИБ"
    signoz = softwareSystem "SigNoz" "Корпоративная платформа observability" "External,Observability"

    tele = softwareSystem "Система телеметрии" "Прием, хранение и отображение технической телеметрии парка" {

      group "Вне Kubernetes" {
        broker = container "Брокер MQTT" "Терминация mTLS, проверка источника, ACL по топикам, постоянные сессии" "EMQX" "С состоянием,Очередь"
        tsdb = container "Хранилище временных рядов" "Измерения 12 мес., сжатие, непрерывные агрегаты." "PostgreSQL + TimescaleDB" "С состоянием,База данных"
      }

      group "Kubernetes" {
        ingest = container "Сервис приема" "Разбор батчей, нормализация, дедупликация, пакетная запись" 
        api = container "Сервис API" "REST и поток реального времени, аутентификация через AD"
        web = container "Веб-интерфейс" "Дашборд: парк, карточка машины, графики, журнал аварий. Статика из кластера, исполняется в браузере" "React SPA" "Браузер"
        logger = container "Сервис логирования" "Прием логов и метрик компонентов, отбор событий ИБ, маршрутизация: ИБ -> SIEM, остальное -> SigNoz" "OpenTelemetry Collector" "С состоянием"
      }
    }

    # Основной тракт телеметрии
    gateway -> broker "Батчи измерений раз в 5 с; догон после обрыва - отдельный топик с низким приоритетом" "MQTT over TLS (mTLS), QoS 1, TCP 8883" "Телеметрия"
    ingest -> broker "Подписка на топики" "MQTT over TLS, TCP 8883" "Телеметрия"
    ingest -> tsdb "Идемпотентная пакетная запись" "SQL, TCP 5432" "Телеметрия"
    api -> tsdb "Выборки рядов и агрегатов" "SQL, TCP 5432"
    web -> api "Запросы дашборда и поток реального времени 1-4 Гц" "HTTPS/JSON, WebSocket"
    mechanic -> web "Просмотр состояния парка" "HTTPS, TCP 443"
 
    api -> ad "Проверка учетных данных и членства в группах" "LDAPS, TCP 636" "ИБ"

    # Логи, метрики и события ИБ
    broker -> logger "Журнал доставки, отказы mTLS/ACL, метрики" "OTLP/gRPC, TCP 4317" "Наблюдаемость"
    ingest -> logger "Логи обработки и ошибок нормализации, метрики задержки" "OTLP/gRPC, TCP 4317" "Наблюдаемость"
    api -> logger "Журнал запросов, вход и отказ в доступе, метрики" "OTLP/gRPC, TCP 4317" "Наблюдаемость"
    logger -> siem "События ИБ: вход/отказ, отклонение подключения шлюза" "syslog/CEF over TLS, TCP 6514" "ИБ"
    logger -> signoz "Операционные логи и метрики" "OTLP/gRPC over TLS, TCP 4317" "Наблюдаемость"
    opsEngineer -> signoz "Мониторинг, разбор инцидентов, оповещения" "HTTPS"

    deploymentEnvironment "Production" {

      board = deploymentNode "Карьерная техника" "Пилот: 3 самосвала, горизонт - 60 единиц" "Бортовая сеть" "" 3 {
        controller = infrastructureNode "Бортовой контроллер" "40 регистров: 1 Гц и 0,2 Гц по группам" "Modbus RTU, RS-485"
        gatewayInst = softwareSystemInstance gateway
      }

      operator = deploymentNode "Оператор связи" "Радиосеть и закрытый APN 10.250.0.0/24" "LTE" {
        apn = infrastructureNode "Закрытый APN" "Адреса SIM-модулей шлюзов 10.250.0.0/24" "LTE, APN"
      }

      site = deploymentNode "Площадка ГОК" "Собственная инфраструктура комбината" {

        perimeter = deploymentNode "Периметр" "Стык IPsec 172.31.255.0/30" {
          fw = infrastructureNode "Межсетевой экран" "Терминация IPsec, фильтрация между зонами (таблица правил в 2-network.md)" "172.31.255.2" "Межсетевой экран"
        }

        dmz = deploymentNode "DMZ" "10.20.10.0/24, единственная зона, принимающая трафик от техники" "" "Зона DMZ" {
          brokerVm = deploymentNode "ВМ брокера" "VIP 10.20.10.10, локальный диск для сессий" "Linux" {
            brokerInst = containerInstance broker
          }
        }

        comp = deploymentNode "COMP" "10.20.20.0/24, обработка и данные" {

          k8s = deploymentNode "Kubernetes" "Собственный кластер площадки (допущение 10)" "Kubernetes" "Kubernetes" {
            ingress = infrastructureNode "Ingress-контроллер" "VIP веб-интерфейса, терминация TLS" "Ingress, TCP 443"

            ingestPod = deploymentNode "ingest" "Без состояния, масштабируется репликами" "Deployment" "" 2 {
              ingestInst = containerInstance ingest
            }
            apiPod = deploymentNode "api" "Без состояния, PodDisruptionBudget" "Deployment" "" 2 {
              apiInst = containerInstance api
            }
            webPod = deploymentNode "web" "Статика SPA" "Deployment, nginx" "" 2 {
              webInst = containerInstance web
            }
            loggerPod = deploymentNode "logger" "Дисковая очередь на PVC" "StatefulSet" {
              loggerInst = containerInstance logger
            }
          }

          dbVm = deploymentNode "ВМ СУБД" "10.20.20.11, выделенные диски, не под кластера" "Linux" {
            tsdbInst = containerInstance tsdb
          }

          backup = infrastructureNode "Хранилище резервных копий" "Полные копии и архив WAL СУБД, проверка восстановления в ПМИ" "pgBackRest"
        }

        corp = deploymentNode "CORP" "10.40.10.0/24, существующие сервисы предприятия" {
          adInst = softwareSystemInstance ad
          siemInst = softwareSystemInstance siem
          signozInst = softwareSystemInstance signoz
          ntp = infrastructureNode "Служба точного времени" "10.40.10.10" "NTP"
        }

        user = deploymentNode "USER" "10.50.10.0/24, рабочие места службы главного механика" {
          arm = deploymentNode "АРМ механика" "" "Windows" {
            browser = infrastructureNode "Браузер" "" "Chromium"
          }
        }
      }

      # Физический путь телеметрии: борт -> оператор -> МЭ -> брокер
      gatewayInst -> controller "Опрос регистров" "Modbus RTU" "Телеметрия"
      gatewayInst -> apn "Батчи измерений" "MQTT over TLS через LTE" "Телеметрия"
      apn -> fw "Туннель site-to-site" "IPsec: UDP 500/4500, ESP" "Телеметрия"
      fw -> brokerInst "Разрешено только шлюзам (правило 3)" "TCP 8883" "Телеметрия"

      # Путь пользователя
      browser -> ingress "Дашборд (правило 11)" "HTTPS, TCP 443"
      ingress -> webInst "Статика SPA" "HTTP"
      ingress -> apiInst "REST и WebSocket" "HTTP"

      # Инфраструктурные потоки
      fw -> siemInst "Логи МЭ (правило 12)" "syslog over TLS, TCP 6514" "ИБ"
      dbVm -> backup "Резервное копирование, архив WAL" "pgBackRest" "Инфраструктура"
      k8s -> ntp "Синхронизация времени (правило 9)" "NTP, UDP 123" "Инфраструктура"
      brokerVm -> ntp "Синхронизация времени" "NTP, UDP 123" "Инфраструктура"
      dbVm -> ntp "Синхронизация времени" "NTP, UDP 123" "Инфраструктура"
    }
  }

  views {
    systemContext tele "context" "Система телеметрии и ее окружение" {
      title "Контекст"
      include *
      include opsEngineer
      autolayout lr
    }

    container tele "containers" "Компоненты решения" {
      title "Контейнеры"
      include *
      autolayout lr
    }

    styles {
      element "Element" {
        color #ffffff
        stroke #0b7166
        strokeWidth 2
      }
      element "Person" {
        shape Person
        background #0b7166
        stroke #0b7166
      }
      element "Software System" {
        background #0b7166
      }
      element "Container" {
        background #0e8c7e
      }
      element "External" {
        background #5f6f6d
        stroke #475a58
      }
      element "Устройство" {
        shape Box
      }
      element "Очередь" {
        shape Pipe
      }
      element "База данных" {
        shape Cylinder
      }
      element "Браузер" {
        shape WebBrowser
      }
      element "С состоянием" {
        stroke #e0492f
        strokeWidth 8
      }
      element "Group" {
        color #0b7166
        stroke #0b7166
        strokeWidth 2
        border dashed
      }
      element "Deployment Node" {
        background #f4f7f7
        color #10201f
        stroke #475a58
      }
      element "Kubernetes" {
        stroke #12a594
        strokeWidth 4
      }
      element "Зона DMZ" {
        stroke #c63d26
        strokeWidth 4
        border dashed
      }
      element "Infrastructure Node" {
        background #dde5e5
        color #10201f
        stroke #475a58
      }
      element "Межсетевой экран" {
        background #c63d26
        color #ffffff
        stroke #c63d26
      }

      relationship "Relationship" {
        color #475a58
        thickness 2
      }
      relationship "Телеметрия" {
        color #0b7166
        thickness 4
      }
      relationship "ИБ" {
        color #c63d26
        thickness 3
      }
      relationship "Наблюдаемость" {
        color #7b848b
        style dashed
      }
      relationship "Инфраструктура" {
        color #7b848b
        style dotted
      }
    }
  }
}
